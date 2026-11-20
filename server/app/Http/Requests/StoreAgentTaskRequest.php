<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Form Request — создание задачи для ИИ-агента.
 * Laravel проверяет данные по rules() ДО вызова контроллера; если правило нарушено,
 * клиент сразу получает ответ 422 со списком ошибок, а контроллер не выполняется.
 */
class StoreAgentTaskRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'title' => ['nullable', 'string', 'max:150'],
            'prompt' => ['required', 'string', 'min:3', 'max:8000'],
            'workspace' => ['nullable', 'string', 'max:255'],
            'mode' => ['nullable', 'in:solo,team'],                     // один агент или команда «Вместе»
            'parent_id' => ['nullable', 'integer', 'exists:agent_tasks,id'], // подзадача командной задачи
        ];
    }
}
