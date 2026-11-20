<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Form Request — переименование чата или смена его нейросети.
 * Laravel проверяет данные по rules() ДО вызова контроллера; если правило нарушено,
 * клиент сразу получает ответ 422 со списком ошибок, а контроллер не выполняется.
 */
class UpdateChatRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'title' => ['sometimes', 'required', 'string', 'max:150'],
            'ai_model_id' => ['sometimes', 'required', 'integer', Rule::exists('ai_models', 'id')->where('is_active', true)],
        ];
    }
}
