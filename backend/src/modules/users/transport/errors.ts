import { AppError } from '../../../http/errors'
import { UsersFailure } from '../domain/errors'

export function toUsersAppError(error: unknown) {
  if (!(error instanceof UsersFailure)) return error

  if (error.kind === 'forbidden') {
    return new AppError(403, 'USERS_ADMIN_REQUIRED', 'Действие доступно только администратору.')
  }
  if (error.kind === 'not_found') {
    return new AppError(404, 'USERS_NOT_FOUND', 'Пользователь не найден.')
  }
  if (error.kind === 'self_demotion') {
    return new AppError(409, 'USERS_SELF_DEMOTION', 'Нельзя снять роль администратора с самого себя.')
  }
  return new AppError(409, 'USERS_LAST_ADMIN', 'Должен остаться хотя бы один администратор.')
}

export async function executeUsers<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    throw toUsersAppError(error)
  }
}
