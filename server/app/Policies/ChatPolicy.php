<?php

namespace App\Policies;

use App\Models\Chat;
use App\Models\User;

/**
 * Политика доступа к чатам: открыть, изменить или удалить чат может только его владелец.
 * В контроллере вызывается Gate::authorize('view', $chat); если метод вернул false — ответ 403.
 */
class ChatPolicy
{
    /** Смотреть чат и его сообщения. */
    public function view(User $user, Chat $chat): bool
    {
        return $chat->user_id === $user->id;
    }

    /** Переименовать чат, сменить модель, отправить сообщение. */
    public function update(User $user, Chat $chat): bool
    {
        return $chat->user_id === $user->id;
    }

    /** Удалить чат. */
    public function delete(User $user, Chat $chat): bool
    {
        return $chat->user_id === $user->id;
    }
}
