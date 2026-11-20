<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Form Request — добавление и изменение нейросети администратором.
 * Laravel проверяет данные по rules() ДО вызова контроллера; если правило нарушено,
 * клиент сразу получает ответ 422 со списком ошибок, а контроллер не выполняется.
 */
class AiModelRequest extends FormRequest
{
    public function rules(): array
    {
        // При создании (POST) поля обязательны, при изменении (PUT/PATCH) можно прислать только изменённые.
        $required = $this->isMethod('post') ? 'required' : 'sometimes';

        return [
            'slug' => [$required, 'string', 'max:60', 'alpha_dash', Rule::unique('ai_models', 'slug')->ignore($this->route('aiModel'))], // slug уникален, кроме самой изменяемой модели
            'name' => [$required, 'string', 'max:100'],
            'provider' => [$required, Rule::in(array_keys(config('ai.providers')))], // только провайдеры из config/ai.php
            'model' => [$required, 'string', 'max:150'],
            'type' => [$required, 'in:text,image,agent'],
            'description' => ['nullable', 'string', 'max:255'],
            'system_prompt' => ['nullable', 'string', 'max:5000'],
            'daily_limit' => [$required, 'integer', 'min:0', 'max:100000'], // запросов в день на одного пользователя
            'is_active' => ['sometimes', 'boolean'],
            'sort' => ['sometimes', 'integer', 'min:0', 'max:100000'],
        ];
    }
}
