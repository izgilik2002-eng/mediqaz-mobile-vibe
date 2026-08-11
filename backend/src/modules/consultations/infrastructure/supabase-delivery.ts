import { MED_CARD_EMPTY_SECTION, type MedCard, type PrescriptionItem } from '@mediqaz/contracts'

import type { FetchLike, MedCardDeliveryPublisher } from '../application/ports'

/**
 * Flattens the structured med card into the shape the browser extension
 * understands: seven flat sections, each `{ текст, цитата }`, диагноз also
 * carrying мкб10. The extension is a separate, unmodified codebase — its own
 * repository, its own release — and its renderer reads exactly that shape by
 * key name. A field added to the card since the extension shipped cannot
 * reach it by adding a new top-level key: the extension's renderer does not
 * know that key exists and will not look at it. It can only arrive by folding
 * into a section the extension already renders.
 *
 * Nothing here is dropped, only reshaped:
 * - назначения.items becomes one line per drug — "Препарат — доза,
 *   кратность, длительность, условие приёма" — with every null field simply
 *   left out of that line rather than printed as the word "null".
 * - красные_флаги, which the extension has no key for at all, is appended to
 *   the end of рекомендации.текст under a "СРОЧНО ОБРАТИТЬСЯ ПРИ:" heading.
 *   If the doctor named no red flags, рекомендации is sent unchanged.
 * - диагноз_врача maps straight onto the extension's `диагноз` key. The
 *   model is never asked for a diagnosis of its own — see med-card.ts — so
 *   there is nothing else to fold in here: `мкб10` is only ever the doctor's
 *   own code, or empty. That field is not decorative: the extension's
 *   `buildContentText` (content.js) writes it into the МИС entry as a bare
 *   "МКБ-10: {код}" line, so anything placed there enters the official record
 *   carrying the doctor's authority.
 */
export function toExtensionMedCard(medCard: MedCard) {
  const prescriptionsText = medCard.назначения.items.length
    ? medCard.назначения.items.map(formatPrescriptionLine).join('\n')
    : MED_CARD_EMPTY_SECTION

  // Exactly one citation, never joined: the extension's Linked Evidence
  // (sidepanel.js findAudioTimestamp) matches only a prefix of a few words to
  // find where a quote starts, then plays until a point derived from the
  // FULL search string's word count. A joined "цитата1 / цитата2" would find
  // the right start — cитата1's — but compute an end offset stretched by
  // цитата2's length, landing the playback somewhere else in the recording
  // while the button still looks like it points at cитата1.
  const prescriptionsQuote = medCard.назначения.items.find((item) => item.цитата !== '')?.цитата ?? ''

  const redFlagsText = medCard.красные_флаги.текст
  const recommendationsText = redFlagsText
    ? `${medCard.рекомендации.текст}\n\nСРОЧНО ОБРАТИТЬСЯ ПРИ: ${redFlagsText}`
    : medCard.рекомендации.текст

  return {
    тип_приема: medCard.тип_приема,
    жалобы: medCard.жалобы,
    анамнез: medCard.анамнез,
    объективно: medCard.объективно,
    диагноз: toExtensionDiagnosis(medCard),
    назначения: { текст: prescriptionsText, цитата: prescriptionsQuote },
    рекомендации: { текст: recommendationsText, цитата: medCard.рекомендации.цитата },
    следующий_прием: medCard.следующий_прием,
  }
}

function toExtensionDiagnosis(medCard: MedCard) {
  const doctor = medCard.диагноз_врача

  // Three distinguishable states, because the schema allows all three and
  // collapsing them would misreport what the doctor did.
  const text =
    doctor.текст ?? (doctor.мкб10 ? 'Диагноз назван только кодом' : 'Диагноз не назван явно')

  return {
    текст: text,
    мкб10: doctor.мкб10 ?? '',
    цитата: doctor.цитата,
  }
}

function formatPrescriptionLine(item: PrescriptionItem) {
  const details = [item.доза, item.кратность, item.длительность, item.условие_приема].filter(
    (field): field is string => field !== null,
  )
  return details.length ? `${item.препарат} — ${details.join(', ')}` : item.препарат
}

/**
 * Writes the med card into the Supabase table the browser extension claims
 * from. Plain PostgREST over fetch rather than the Supabase SDK: this is one
 * upsert, and a client library would pull a dependency into the backend for it.
 *
 * The secret key bypasses row-level security, which is exactly why the table
 * has no policies at all — nothing but this adapter can write to it, and only
 * the `claim_medcards` function can read it.
 */
export function createSupabaseMedCardDeliveryPublisher({
  url,
  secretKey,
  fetchImpl = fetch,
  timeoutMs = 8_000,
}: {
  url: string
  secretKey: string
  fetchImpl?: FetchLike
  timeoutMs?: number
}): MedCardDeliveryPublisher {
  // Tolerates a project URL pasted with a trailing slash or with the REST path
  // already appended, both of which are what the Supabase dashboard shows.
  const origin = url.trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, '')
  // on_conflict is required, not decorative: `resolution=merge-duplicates`
  // resolves against the primary key unless told otherwise, and ours is a
  // generated `id` that a re-send never repeats. Without naming the real
  // conflict target, the second delivery of one consultation hits the
  // (doctor_code, appointment_id) unique index and fails instead of replacing.
  const endpoint = `${origin}/rest/v1/medcard_deliveries?on_conflict=doctor_code,appointment_id`

  return {
    async publish({ doctorCode, appointmentId, patientName, medCard, expiresAt }) {
      let response: Response
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            apikey: secretKey,
            Authorization: `Bearer ${secretKey}`,
            'Content-Type': 'application/json',
            // Re-sending the same consultation replaces its pending row instead
            // of queueing a second banner for the doctor.
            Prefer: 'resolution=merge-duplicates,return=minimal',
          },
          body: JSON.stringify({
            doctor_code: doctorCode,
            appointment_id: appointmentId,
            patient_name: patientName ?? null,
            transcript_json: toExtensionMedCard(medCard),
            // Sent explicitly: the column default only applies to an INSERT, so
            // a re-send would otherwise inherit the original row's expiry and
            // could be swept moments after the doctor asked for it again.
            expires_at: expiresAt.toISOString(),
          }),
          signal: AbortSignal.timeout(timeoutMs),
        })
      } catch (cause) {
        // No response at all: DNS, TLS, or the timeout above. Without this the
        // failure is indistinguishable from a rejection by PostgREST.
        console.error('[mis-delivery] no response from Supabase', {
          endpoint,
          appointmentId,
          cause: cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause),
        })
        throw new Error('Supabase delivery failed before a response arrived')
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '<body could not be read>')
        console.error('[mis-delivery] Supabase rejected the delivery', {
          endpoint,
          appointmentId,
          status: response.status,
          statusText: response.statusText,
          // PostgREST answers with its own error JSON here — code, message,
          // details, hint — which is the whole point of logging this.
          body: safeForLogs(body, doctorCode),
        })
        throw new Error(`Supabase delivery failed with status ${response.status}`)
      }
    },
  }
}

/**
 * PostgREST error bodies are diagnostic, but not unconditionally safe to log.
 * A unique violation spells the conflicting key out in `details` — which here
 * means the doctor's delivery code, the one secret standing between doctors'
 * med cards. That gets masked. The length cap is for the pathological case
 * where an error echoes the submitted row back and drags patient data with it.
 */
function safeForLogs(body: string, doctorCode: string) {
  const masked = doctorCode ? body.split(doctorCode).join('<doctor-code>') : body
  return masked.length > 2_000 ? `${masked.slice(0, 2_000)}… <truncated>` : masked
}
