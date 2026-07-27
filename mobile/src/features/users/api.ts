import {
  updateProfileRequestSchema,
  updateProfileResponseSchema,
  type UpdateProfileRequest,
  type UpdateProfileResponse,
} from '@mediqaz/contracts';

import type { ApiTransport } from '@/platform/api';

export class UsersApi {
  constructor(private readonly transport: ApiTransport) {}

  updateProfile(input: UpdateProfileRequest): Promise<UpdateProfileResponse> {
    return this.transport.request('/api/users/me', updateProfileResponseSchema, {
      method: 'PATCH',
      body: updateProfileRequestSchema.parse(input),
      auth: true,
    });
  }
}
