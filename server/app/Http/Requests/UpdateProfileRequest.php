<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Form Request — изменение профиля: имя и пароль.
 * Laravel проверяет данные по rules() ДО вызова контроллера; если правило нарушено,
 * клиент сразу получает ответ 422 со списком ошибок, а контроллер не выполняется.
 */
class UpdateProfileRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'name' => ['sometimes', 'required', 'string', 'max:100'],
            // Аккаунт, созданный через Google / GitHub / Apple, ставит первый пароль без старого.
            // current_password:sanctum — Laravel сам сверяет введённый старый пароль с хешем в БД.
            'current_password' => $this->user()->password === null ? ['nullable'] : ['required_with:password', 'current_password:sanctum'],
            'password' => ['sometimes', 'required', 'string', 'min:8', 'max:100'],
        ];
    }
}
