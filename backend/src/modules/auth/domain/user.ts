import type {
  DoctorSpecialty,
  TranscriptionLanguage,
  UserDto,
  UserRole,
} from '@mediqaz/contracts'

export type AuthUserRecord = {
  id: string
  email: string
  passwordHash: string | null
  displayName: string | null
  role: UserRole
  isApproved: boolean
  specialty: DoctorSpecialty | null
  transcriptionLanguage: TranscriptionLanguage
  createdAt: Date
}

export type AuthenticatedPrincipal = UserDto & {
  sessionId: string
}

export function toUserDto(user: AuthUserRecord): UserDto {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    isApproved: user.isApproved,
    specialty: user.specialty,
    transcriptionLanguage: user.transcriptionLanguage,
    createdAt: user.createdAt.toISOString(),
  }
}

export function userDtoFromPrincipal(principal: AuthenticatedPrincipal): UserDto {
  const { sessionId: _sessionId, ...user } = principal
  return user
}
