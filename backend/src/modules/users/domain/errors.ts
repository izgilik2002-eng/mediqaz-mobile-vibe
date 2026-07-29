export type UsersFailureKind = 'forbidden' | 'not_found' | 'self_demotion' | 'last_admin'

export class UsersFailure extends Error {
  constructor(
    public readonly kind: UsersFailureKind,
    message: string,
  ) {
    super(message)
  }
}
