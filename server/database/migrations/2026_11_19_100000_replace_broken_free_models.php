<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Постмортем моделей (19.11.2026): проверка каждой модели живым запросом.
 *  - MiniMax M3.1 Flash — OpenRouter снял бесплатный вариант 22.10.2026, любой запрос → HTTP 404;
 *  - Gemma 4 31B — 0 ответов, постоянно «перегружена» (лимит Google на бесплатный тариф).
 * Обе выключаем (не удаляем — на них ссылаются старые сообщения) и добавляем проверенные замены:
 * ERNIE 5.5 Flash (ответ за 1,5 с, умеет вызывать инструменты) и Nemotron 3.5 Super.
 */
return new class extends Migration
{
    private const NEW_MODELS = [
        [
            'slug' => 'or-nemotron-super', 'name' => 'Nemotron 3.5 Super', 'model' => 'nvidia/nemotron-3.5-super-vl:free',
            'type' => 'text', 'daily_limit' => 30, 'sort' => 72,
            'description' => 'Новая модель NVIDIA: быстрые и точные ответы',
            'system_prompt' => 'Отвечай на языке пользователя, используй Markdown.',
        ],
        [
            'slug' => 'or-ernie', 'name' => 'ERNIE 5.5 Flash', 'model' => 'baidu/ernie-5.5-flash-preview:free',
            'type' => 'text', 'daily_limit' => 30, 'sort' => 73,
            'description' => 'Самая быстрая бесплатная модель (Baidu), ответ за 1–2 секунды',
            'system_prompt' => 'Отвечай на языке пользователя, используй Markdown.',
        ],
        [
            'slug' => 'openrouter-agent-ernie', 'name' => 'Mansur Agent (ERNIE Flash)', 'model' => 'baidu/ernie-5.5-flash-preview:free',
            'type' => 'agent', 'daily_limit' => 500, 'sort' => 32,
            'description' => 'Быстрая запасная модель агента (умеет вызывать инструменты)',
            'system_prompt' => null,
        ],
    ];

    /** Применить: выключить сломанные модели и добавить новые. */
    public function up(): void
    {
        DB::table('ai_models')->whereIn('slug', ['or-gemma-4', 'or-minimax'])->update(['is_active' => false, 'updated_at' => now()]);

        foreach (self::NEW_MODELS as $model) {
            DB::table('ai_models')->updateOrInsert(
                ['slug' => $model['slug']],
                [...$model, 'provider' => 'openrouter', 'is_active' => true, 'created_at' => now(), 'updated_at' => now()],
            );
        }
    }

    /** Откатить: убрать новые модели и снова включить старые. */
    public function down(): void
    {
        DB::table('ai_models')->whereIn('slug', array_column(self::NEW_MODELS, 'slug'))->delete();
        DB::table('ai_models')->whereIn('slug', ['or-gemma-4', 'or-minimax'])->update(['is_active' => true]);
    }
};
