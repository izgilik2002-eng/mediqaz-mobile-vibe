import {
  generateMedCardResponseSchema,
  misDeliveryCodeResponseSchema,
  misDeliveryResponseSchema,
  startAppointmentRequestSchema,
  startAppointmentResponseSchema,
  type GenerateMedCardResponse,
  type MisDeliveryCodeResponse,
  type MisDeliveryResponse,
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

  /** Issues the code on first call, so the doctor can set the extension up
   *  before ever recording a consultation. */
  misDeliveryCode(): Promise<MisDeliveryCodeResponse> {
    return this.transport.request(
      '/api/consultations/mis-delivery-code',
      misDeliveryCodeResponseSchema,
      { auth: true },
    );
  }

  regenerateMisDeliveryCode(): Promise<MisDeliveryCodeResponse> {
    return this.transport.request(
      '/api/consultations/mis-delivery-code/regenerate',
      misDeliveryCodeResponseSchema,
      { method: 'POST', auth: true },
    );
  }

  /** Safe to call repeatedly: the backend replaces the pending delivery rather
   *  than queueing a second one, so a retry cannot double up on the doctor. */
  sendMedCardToMis(appointmentId: string): Promise<MisDeliveryResponse> {
    return this.transport.request(
      `/api/consultations/appointments/${appointmentId}/mis-delivery`,
      misDeliveryResponseSchema,
      { method: 'POST', auth: true },
    );
  }
}
