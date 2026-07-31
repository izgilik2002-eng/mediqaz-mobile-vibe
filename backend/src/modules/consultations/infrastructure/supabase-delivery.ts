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
  const endpoint = `${origin}/rest/v1/medcard_deliveries`

  return {
    async publish({ doctorCode, appointmentId, patientName, medCard, expiresAt }) {
      const response = await fetchImpl(endpoint, {
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
          // Sent explicitly: the column default only applies to an INSERT, so a
          // re-send would otherwise inherit the original row's expiry and could
          // be swept moments after the doctor asked for it again.
          expires_at: expiresAt.toISOString(),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      })

      if (!response.ok) {
        // The body can echo the row back, med card included, so only the status
        // is surfaced. Patient data must not reach logs or error tracking.
        throw new Error(`Supabase delivery failed with status ${response.status}`)
      }
    },
  }
}
