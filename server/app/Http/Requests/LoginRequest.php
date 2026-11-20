<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Form Request — вход по email и паролю.
 * Laravel проверяет данные по rules() ДО вызова контроллера; если правило нарушено,
 * клиент сразу получает ответ 422 со списком ошибок, а контроллер не выполняется.
 */
class LoginRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'email' => ['required', 'email'],
            'password' => ['required', 'string'],
            'client' => ['nullable', 'in:web,desktop'], // desktop — токен получит дополнительное право «agent»
        ];
    }
}
