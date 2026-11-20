<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Form Request — один шаг рассуждения агента (история сообщений + описания инструментов).
 * Laravel проверяет данные по rules() ДО вызова контроллера; если правило нарушено,
 * клиент сразу получает ответ 422 со списком ошибок, а контроллер не выполняется.
 */
class AgentStepRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'messages' => ['required', 'array', 'min:1', 'max:200'],
            'messages.*.role' => ['required', 'in:system,user,assistant,tool'], // формат OpenAI: роль каждого сообщения
            'tools' => ['present', 'array', 'max:30'],                         // инструменты агента: файлы, PowerShell, браузер…
        ];
    }
}
