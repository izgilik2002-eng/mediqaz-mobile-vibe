-- MediQaz — канал доставки медкарты «телефон → расширение».
--
-- ПЕРЕД ПРОГОНОМ: включите расширение pg_cron вручную в панели Supabase,
-- Database → Extensions → pg_cron. Без него блок с cron.schedule в конце
-- скрипта упадёт, а вместе с ним не создадутся задачи очистки.
--
-- Скрипт прогоняется целиком в SQL Editor проекта Supabase.
--
-- Модель доступа:
--   • medcard_deliveries — RLS включён, политик нет вообще. Публикуемый
--     (publishable/anon) ключ не читает эту таблицу никак. Бэкенд ходит
--     секретным (secret/service_role) ключом и RLS обходит.
--   • Забор медкарт — только через RPC claim_medcards, которая требует код
--     врача. Код и есть секрет: расширение раздаётся публично вместе со
--     своим ключом, поэтому граница безопасности не в ключе, а в коде.
--   • delivery_signals — «дверной звонок». Не содержит ни кода врача, ни
--     имени пациента, ни идентификатора приёма: только id и время. Его
--     единственная задача — разбудить расширение, чтобы оно сходило в RPC.

-- ════════════════════════════════════════════════════════════════════
-- Канал доставки, не хранилище
-- ════════════════════════════════════════════════════════════════════

create table public.medcard_deliveries (
  id              uuid        primary key default gen_random_uuid(),
  doctor_code     text        not null,
  appointment_id  uuid        not null,
  patient_name    text,
  transcript_json jsonb       not null,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default now() + interval '24 hours'
);

-- Повторная отправка того же приёма заменяет строку, а не плодит дубли.
-- Бэкенд делает upsert по этому ключу и передаёт expires_at явно, иначе
-- default сработает только на INSERT и повтор не продлит срок жизни.
create unique index medcard_deliveries_doctor_appointment_key
  on public.medcard_deliveries (doctor_code, appointment_id);

create index medcard_deliveries_expires_at_idx
  on public.medcard_deliveries (expires_at);

alter table public.medcard_deliveries enable row level security;

-- Ни одной policy не создаём — это осознанно. При включённом RLS и
-- отсутствии политик таблица недоступна на чтение и запись всем ролям,
-- кроме тех, кто RLS обходит (владелец и service_role).
revoke all on public.medcard_deliveries from anon, authenticated;

-- ════════════════════════════════════════════════════════════════════
-- Дверной звонок: без PHI, без кода врача
-- ════════════════════════════════════════════════════════════════════

create table public.delivery_signals (
  id         bigserial   primary key,
  created_at timestamptz not null default now()
);

create index delivery_signals_created_at_idx
  on public.delivery_signals (created_at);

alter table public.delivery_signals enable row level security;

create policy "anon may watch the doorbell"
  on public.delivery_signals
  for select
  to anon
  using (true);

-- Грант задаётся явно, а не наследуется из дефолтных привилегий проекта.
grant select on public.delivery_signals to anon;

create function public.notify_delivery() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.delivery_signals default values;
  return new;
end;
$$;

-- И на INSERT, и на UPDATE: повторная отправка приёма обновляет строку
-- через upsert, и врач должен получить звонок так же, как в первый раз.
create trigger medcard_deliveries_notify
  after insert or update on public.medcard_deliveries
  for each row execute function public.notify_delivery();

-- ════════════════════════════════════════════════════════════════════
-- Забор и подтверждение. Код врача обязателен в обеих функциях
-- ════════════════════════════════════════════════════════════════════

create function public.claim_medcards(p_doctor_code text)
returns table (
  id              uuid,
  patient_name    text,
  transcript_json jsonb,
  created_at      timestamptz
)
language sql
security definer
set search_path = public
as $$
  select id, patient_name, transcript_json, created_at
  from public.medcard_deliveries
  where doctor_code = p_doctor_code
    and expires_at > now()
  order by created_at;
$$;

-- Код нужен и здесь: иначе чужую строку можно удалить, угадав только uuid.
create function public.ack_medcard(p_doctor_code text, p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.medcard_deliveries
  where id = p_id
    and doctor_code = p_doctor_code;
$$;

revoke all on function public.claim_medcards(text) from public;
revoke all on function public.ack_medcard(text, uuid) from public;
grant execute on function public.claim_medcards(text) to anon;
grant execute on function public.ack_medcard(text, uuid) to anon;

-- ════════════════════════════════════════════════════════════════════
-- Realtime: публикуется ТОЛЬКО звонок
-- ════════════════════════════════════════════════════════════════════

-- medcard_deliveries намеренно НЕ добавляется в supabase_realtime:
-- медкарты уходят исключительно через claim_medcards. Если добавить её
-- сюда, содержимое поедет подписчикам в обход RPC и код врача перестанет
-- что-либо защищать.
alter publication supabase_realtime add table public.delivery_signals;

-- ════════════════════════════════════════════════════════════════════
-- Очистка. Требует включённого pg_cron (см. шапку файла)
-- ════════════════════════════════════════════════════════════════════

-- Медкарта, которую врач так и не забрал, живёт сутки и удаляется.
-- Потерей это не является: карта остаётся в собственной БД бэкенда, и
-- врач может отправить её с телефона повторно.
select cron.schedule(
  'sweep-medcard-deliveries',
  '*/15 * * * *',
  $$delete from public.medcard_deliveries where expires_at <= now()$$
);

-- Звонки — чистый расходник: разбудили расширение и больше не нужны.
-- Держим последний час, чтобы панель, открытая сразу после отправки,
-- ещё успела увидеть событие.
select cron.schedule(
  'sweep-delivery-signals',
  '0 * * * *',
  $$delete from public.delivery_signals where created_at < now() - interval '1 hour'$$
);
