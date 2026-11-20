<?php

namespace Database\Seeders;

use App\Models\AiModel;
use App\Models\User;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    use WithoutModelEvents;

    /**
     * Seed the application's database.
     */
    public function run(): void
    {
        $admin = User::firstOrNew(['email' => env('ADMIN_EMAIL', 'admin@mansur.ai')]);
        $admin->fill(['name' => 'Администратор', 'password' => env('ADMIN_PASSWORD', 'admin12345')]);
        $admin->role = User::ROLE_ADMIN;
        $admin->save();

        $models = [
            [
                'slug' => 'mansur-chat', 'name' => 'Mansur Chat', 'provider' => 'pollinations', 'model' => 'openai-fast',
                'type' => 'text', 'daily_limit' => 100, 'sort' => 10,
                'description' => 'Универсальный помощник: ответы на вопросы, тексты, переводы (GPT-OSS 20B)',
                'system_prompt' => <<<'TXT'
Ты — Mansur AI, умный и внимательный ИИ-помощник. Отвечай на языке пользователя (по умолчанию — по-русски).
Как отвечать:
- Сначала главное: прямой ответ в 1–2 предложениях, затем подробности.
- Структурируй: короткие абзацы, заголовки для длинных ответов, списки для шагов и вариантов, таблицы для сравнений.
- Объясняй простыми словами и приводи конкретный пример; термины расшифровывай.
- Будь точным: не выдумывай факты, цифры и ссылки. Если не уверен — так и скажи и предложи, как проверить.
- Если вопрос неясен, дай лучший ответ по наиболее вероятному смыслу и одной фразой уточни остальное.
- Учитывай всю историю разговора: отвечай на уточнения, не повторяя уже сказанное.
- Без воды и лишних извинений; тон дружелюбный и уверенный.
TXT,
            ],
            [
                'slug' => 'mansur-coder', 'name' => 'Mansur Coder', 'provider' => 'pollinations', 'model' => 'openai-fast',
                'type' => 'text', 'daily_limit' => 100, 'sort' => 20,
                'description' => 'Программист: пишет и объясняет код, ищет ошибки (GPT-OSS 20B)',
                'system_prompt' => <<<'TXT'
Ты — Mansur Coder, senior-разработчик. Отвечай на языке пользователя (по умолчанию — по-русски), код и имена в коде — на английском.
Как отвечать:
- Сначала коротко: что делаем и почему так.
- Давай полный, рабочий, готовый к запуску код в блоках ```язык``` — без «…» и «здесь ваш код». Указывай имена файлов.
- Пиши современно и чисто: понятные имена, обработка ошибок, без лишних зависимостей.
- После кода — как запустить и проверить (команды), и типичные ошибки.
- При поиске бага: назови причину, покажи исправленный фрагмент и объясни, почему он работает.
- Если есть важная проблема безопасности или производительности — предупреди.
- Учитывай всю историю разговора и уже написанный код.
TXT,
            ],
            [
                'slug' => 'mansur-image', 'name' => 'Mansur Image', 'provider' => 'pollinations', 'model' => 'sana',
                'type' => 'image', 'daily_limit' => 30, 'sort' => 30,
                'description' => 'Создаёт изображения по текстовому описанию',
                'system_prompt' => null,
            ],
            [
                'slug' => 'mansur-agent', 'name' => 'Mansur Agent', 'provider' => 'pollinations', 'model' => 'openai-fast',
                'type' => 'agent', 'daily_limit' => 500, 'sort' => 40,
                'description' => 'Модель ИИ-агента Windows-приложения (шаги выполнения задач)',
                'system_prompt' => null,
            ],
            // Agent models on faster providers: used instead of Pollinations once their key is set (lower sort wins).
            [
                'slug' => 'groq-agent', 'name' => 'Mansur Agent (Groq)', 'provider' => 'groq', 'model' => 'openai/gpt-oss-120b',
                'type' => 'agent', 'daily_limit' => 500, 'sort' => 26,
                'description' => 'Модель агента через Groq — быстрее',
                'system_prompt' => null,
            ],
            [
                'slug' => 'gemini-agent', 'name' => 'Mansur Agent (Gemini)', 'provider' => 'gemini', 'model' => 'gemini-flash-latest',
                'type' => 'agent', 'daily_limit' => 300, 'sort' => 25,
                'description' => 'Модель агента через Google Gemini',
                'system_prompt' => null,
            ],
            [
                'slug' => 'cerebras-agent', 'name' => 'Mansur Agent (Cerebras)', 'provider' => 'cerebras', 'model' => 'gpt-oss-120b',
                'type' => 'agent', 'daily_limit' => 500, 'sort' => 27,
                'description' => 'Модель агента через Cerebras',
                'system_prompt' => null,
            ],
            [
                'slug' => 'openrouter-agent-nemotron', 'name' => 'Mansur Agent (Nemotron 550B)', 'provider' => 'openrouter', 'model' => 'nvidia/nemotron-3-ultra-550b-a55b:free',
                'type' => 'agent', 'daily_limit' => 500, 'sort' => 30,
                'description' => 'Сильная модель агента: лучше пишет код и сайты',
                'system_prompt' => null,
            ],
            [
                'slug' => 'openrouter-agent-north', 'name' => 'Mansur Agent (North Code)', 'provider' => 'openrouter', 'model' => 'cohere/north-mini-code:free',
                'type' => 'agent', 'daily_limit' => 500, 'sort' => 31,
                'description' => 'Запасная модель агента для кода',
                'system_prompt' => null,
            ],
            [
                'slug' => 'openrouter-agent-ernie', 'name' => 'Mansur Agent (ERNIE Flash)', 'provider' => 'openrouter', 'model' => 'baidu/ernie-5.5-flash-preview:free',
                'type' => 'agent', 'daily_limit' => 500, 'sort' => 32,
                'description' => 'Быстрая запасная модель агента (умеет вызывать инструменты)',
                'system_prompt' => null,
            ],
            // Free-tier providers: they appear for users as soon as the admin adds a key.
            [
                'slug' => 'gemini-flash', 'name' => 'Gemini Flash', 'provider' => 'gemini', 'model' => 'gemini-flash-latest',
                'type' => 'text', 'daily_limit' => 50, 'sort' => 50,
                'description' => 'Новейшая быстрая модель Google',
                'system_prompt' => 'Отвечай на языке пользователя, используй Markdown.',
            ],
            [
                'slug' => 'gemini-flash-lite', 'name' => 'Gemini Flash-Lite', 'provider' => 'gemini', 'model' => 'gemini-flash-lite-latest',
                'type' => 'text', 'daily_limit' => 100, 'sort' => 51,
                'description' => 'Лёгкая и очень быстрая модель Google',
                'system_prompt' => 'Отвечай на языке пользователя, используй Markdown.',
            ],
            [
                'slug' => 'groq-gpt-oss-120b', 'name' => 'GPT-OSS 120B', 'provider' => 'groq', 'model' => 'openai/gpt-oss-120b',
                'type' => 'text', 'daily_limit' => 100, 'sort' => 60,
                'description' => 'Большая открытая модель OpenAI на скоростных чипах Groq',
                'system_prompt' => 'Отвечай на языке пользователя, используй Markdown.',
            ],
            [
                'slug' => 'groq-gpt-oss-20b', 'name' => 'GPT-OSS 20B (Groq)', 'provider' => 'groq', 'model' => 'openai/gpt-oss-20b',
                'type' => 'text', 'daily_limit' => 150, 'sort' => 61,
                'description' => 'Быстрая открытая модель OpenAI через Groq',
                'system_prompt' => 'Отвечай на языке пользователя, используй Markdown.',
            ],
            [
                'slug' => 'or-auto', 'name' => 'Авто (лучшая бесплатная)', 'provider' => 'openrouter', 'model' => 'openrouter/free',
                'type' => 'text', 'daily_limit' => 30, 'sort' => 70,
                'description' => 'OpenRouter сам выбирает свободную бесплатную модель',
                'system_prompt' => 'Отвечай на языке пользователя, используй Markdown.',
            ],
            [
                'slug' => 'or-nemotron-ultra', 'name' => 'Nemotron 3 Ultra', 'provider' => 'openrouter', 'model' => 'nvidia/nemotron-3-ultra-550b-a55b:free',
                'type' => 'text', 'daily_limit' => 30, 'sort' => 71,
                'description' => 'Огромная модель NVIDIA (550B) — сложные вопросы',
                'system_prompt' => 'Отвечай на языке пользователя, используй Markdown.',
            ],
            // Заменили Gemma 4 (всегда «перегружена») и MiniMax (снята с бесплатного тарифа) — см. миграцию 2026_11_19.
            [
                'slug' => 'or-nemotron-super', 'name' => 'Nemotron 3.5 Super', 'provider' => 'openrouter', 'model' => 'nvidia/nemotron-3.5-super-vl:free',
                'type' => 'text', 'daily_limit' => 30, 'sort' => 72,
                'description' => 'Новая модель NVIDIA: быстрые и точные ответы',
                'system_prompt' => 'Отвечай на языке пользователя, используй Markdown.',
            ],
            [
                'slug' => 'or-ernie', 'name' => 'ERNIE 5.5 Flash', 'provider' => 'openrouter', 'model' => 'baidu/ernie-5.5-flash-preview:free',
                'type' => 'text', 'daily_limit' => 30, 'sort' => 73,
                'description' => 'Самая быстрая бесплатная модель (Baidu), ответ за 1–2 секунды',
                'system_prompt' => 'Отвечай на языке пользователя, используй Markdown.',
            ],
            [
                'slug' => 'or-north-code', 'name' => 'North Mini Code', 'provider' => 'openrouter', 'model' => 'cohere/north-mini-code:free',
                'type' => 'text', 'daily_limit' => 30, 'sort' => 75,
                'description' => 'Модель Cohere для программирования',
                'system_prompt' => 'Отвечай на языке пользователя, используй Markdown.',
            ],
            [
                'slug' => 'mistral-small', 'name' => 'Mistral Small', 'provider' => 'mistral', 'model' => 'mistral-small-latest',
                'type' => 'text', 'daily_limit' => 50, 'sort' => 80,
                'description' => 'Европейская модель Mistral AI, хорошо знает русский',
                'system_prompt' => 'Отвечай на языке пользователя, используй Markdown.',
            ],
            [
                'slug' => 'mistral-medium', 'name' => 'Mistral Medium', 'provider' => 'mistral', 'model' => 'mistral-medium-latest',
                'type' => 'text', 'daily_limit' => 30, 'sort' => 81,
                'description' => 'Более сильная модель Mistral AI',
                'system_prompt' => 'Отвечай на языке пользователя, используй Markdown.',
            ],
            [
                'slug' => 'cerebras-gpt-oss', 'name' => 'GPT-OSS 120B (Cerebras)', 'provider' => 'cerebras', 'model' => 'gpt-oss-120b',
                'type' => 'text', 'daily_limit' => 100, 'sort' => 90,
                'description' => 'Сверхбыстрые ответы на чипах Cerebras',
                'system_prompt' => 'Отвечай на языке пользователя, используй Markdown.',
            ],
        ];

        foreach ($models as $model) {
            AiModel::updateOrCreate(['slug' => $model['slug']], $model);
        }

        // Retired model ids from earlier versions.
        AiModel::whereIn('slug', ['groq-llama', 'openrouter-deepseek', 'openrouter-qwen-coder'])->delete();
        AiModel::where('provider', 'github')->delete(); // GitHub Models was retired on 30 July 2026
        // Не удаляем, а выключаем: у этих моделей уже есть сообщения в чатах пользователей.
        AiModel::whereIn('slug', ['or-gemma-4', 'or-minimax'])->update(['is_active' => false]);
    }
}
