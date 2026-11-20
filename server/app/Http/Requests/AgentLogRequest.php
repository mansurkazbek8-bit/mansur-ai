<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Form Request — записи журнала задачи от Windows-приложения.
 * Laravel проверяет данные по rules() ДО вызова контроллера; если правило нарушено,
 * клиент сразу получает ответ 422 со списком ошибок, а контроллер не выполняется.
 */
class AgentLogRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'entries' => ['required', 'array', 'min:1', 'max:50'],         // за раз от 1 до 50 записей
            'entries.*.type' => ['required', 'in:info,thought,tool,result,error'], // тип шага: мысль, вызов инструмента, результат…
            'entries.*.text' => ['required', 'string', 'max:20000'],
        ];
    }
}
