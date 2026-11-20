<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Form Request — сообщение в чат (ключевой сценарий 1).
 * Laravel проверяет данные по rules() ДО вызова контроллера; если правило нарушено,
 * клиент сразу получает ответ 422 со списком ошибок, а контроллер не выполняется.
 */
class StoreMessageRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'content' => ['required', 'string', 'min:1', 'max:8000'],      // текст до 8000 символов
            'ai_model_id' => ['nullable', 'integer', 'exists:ai_models,id'], // можно сменить нейросеть прямо в разговоре
        ];
    }

    /** Свой текст ошибки вместо стандартного английского. */
    public function messages(): array
    {
        return ['content.required' => 'Введите сообщение'];
    }
}
