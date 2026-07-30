import {
  generateMedCardResponseSchema,
  startAppointmentRequestSchema,
  startAppointmentResponseSchema,
  type GenerateMedCardResponse,
  type StartAppointmentRequest,
  type StartAppointmentResponse,
} from '@mediqaz/contracts';

import type { ApiTransport } from '@/platform/api';

export class ConsultationsApi {
  constructor(private readonly transport: ApiTransport) {}

  startAppointment(input: StartAppointmentRequest): Promise<StartAppointmentResponse> {
    return this.transport.request('/api/consultations/appointments', startAppointmentResponseSchema, {
      method: 'POST',
      body: startAppointmentRequestSchema.parse(input),
      auth: true,
    });
  }

  uploadRecording(
    appointmentId: string,
    audio: { data: ArrayBuffer | ArrayBufferView<ArrayBuffer>; contentType: string },
  ): Promise<GenerateMedCardResponse> {
    return this.transport.request(
      `/api/consultations/appointments/${appointmentId}/audio`,
      generateMedCardResponseSchema,
      {
        method: 'POST',
        rawBody: audio,
        auth: true,
      },
    );
  }
}
