import type { FetchLike, MedCardDeliveryPublisher } from '../application/ports'

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
            transcript_json: medCard,
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
