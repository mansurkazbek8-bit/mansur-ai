<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Form Request — регистрация нового пользователя.
 * Laravel проверяет данные по rules() ДО вызова контроллера; если правило нарушено,
 * клиент сразу получает ответ 422 со списком ошибок, а контроллер не выполняется.
 */
class RegisterRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:100'],
            'email' => ['required', 'email', 'max:150', 'unique:users,email'], // один аккаунт на один email
            'password' => ['required', 'string', 'min:8', 'max:100'],         // минимум 8 символов (НФТ-2)
            'client' => ['nullable', 'in:web,desktop'],
        ];
    }
}
