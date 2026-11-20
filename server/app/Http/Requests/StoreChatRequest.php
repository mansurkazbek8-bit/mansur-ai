<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Form Request — создание чата.
 * Laravel проверяет данные по rules() ДО вызова контроллера; если правило нарушено,
 * клиент сразу получает ответ 422 со списком ошибок, а контроллер не выполняется.
 */
class StoreChatRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'title' => ['nullable', 'string', 'max:150'],
            'ai_model_id' => ['required', 'integer', Rule::exists('ai_models', 'id')->where('is_active', true)], // только включённая нейросеть
        ];
    }
}
