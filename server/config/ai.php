<?php

/*
| Настройки нейросетей. Все провайдеры понимают OpenAI-совместимый протокол chat/completions,
| поэтому добавить нового провайдера = добавить сюда адрес. Ключи берутся из .env или из
| админ-панели (зашифрованы в app_settings); провайдер без нужного ключа скрыт от пользователей.
| См. App\Services\Providers.
*/

return [

    'timeout' => (int) env('AI_TIMEOUT', 90), // сколько секунд ждать ответа нейросети

    // Сколько секунд суммарно ждать занятый бесплатный тариф, прежде чем сдаться.
    'max_wait' => (int) env('AI_MAX_WAIT', 70),

    'providers' => [
        'pollinations' => [
            'title' => 'Pollinations',
            'url' => env('POLLINATIONS_TEXT_URL', 'https://text.pollinations.ai/openai'),
            'image_url' => env('POLLINATIONS_IMAGE_URL', 'https://image.pollinations.ai/prompt'),
            'models_url' => 'https://text.pollinations.ai/models',
            'env_key' => 'POLLINATIONS_API_KEY',
            'key_required' => false,
            'key_url' => 'https://enter.pollinations.ai',
            'note' => 'Работает без ключа (1 ответ и 1 картинка в 45 с на сервер). Ключ снимает ограничение.',
        ],
        'gemini' => [
            'title' => 'Google Gemini',
            'url' => 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
            'models_url' => 'https://generativelanguage.googleapis.com/v1beta/openai/models',
            'env_key' => 'GEMINI_API_KEY',
            'key_required' => true,
            'key_url' => 'https://aistudio.google.com/apikey',
            'note' => 'Бесплатный тариф Google AI Studio. В AI Studio нажмите «Create API key» — ключ начинается с «AIza» (39 символов).',
        ],
        'groq' => [
            'title' => 'Groq',
            'url' => 'https://api.groq.com/openai/v1/chat/completions',
            'models_url' => 'https://api.groq.com/openai/v1/models',
            'env_key' => 'GROQ_API_KEY',
            'key_required' => true,
            'key_url' => 'https://console.groq.com/keys',
            'note' => 'Очень быстрые открытые модели (GPT-OSS, Qwen). Бесплатный тариф. Ключ начинается с «gsk_» и показывается только один раз — копируйте сразу.',
        ],
        'openrouter' => [
            'title' => 'OpenRouter',
            'url' => 'https://openrouter.ai/api/v1/chat/completions',
            'models_url' => 'https://openrouter.ai/api/v1/models',
            'env_key' => 'OPENROUTER_API_KEY',
            'key_required' => true,
            'key_url' => 'https://openrouter.ai/keys',
            'note' => 'Десятки моделей; бесплатные имеют окончание :free (DeepSeek, Llama, Qwen, Mistral…).',
            'free_only' => true, // в импорте показываются только бесплатные модели (:free)
        ],
        'mistral' => [
            'title' => 'Mistral AI',
            'url' => 'https://api.mistral.ai/v1/chat/completions',
            'models_url' => 'https://api.mistral.ai/v1/models',
            'env_key' => 'MISTRAL_API_KEY',
            'key_required' => true,
            'key_url' => 'https://console.mistral.ai/api-keys',
            'note' => 'Бесплатный тариф «Experiment» для моделей Mistral.',
        ],
        'cerebras' => [
            'title' => 'Cerebras',
            'url' => 'https://api.cerebras.ai/v1/chat/completions',
            'models_url' => 'https://api.cerebras.ai/v1/models',
            'env_key' => 'CEREBRAS_API_KEY',
            'key_required' => true,
            'key_url' => 'https://cloud.cerebras.ai',
            'note' => 'Сверхбыстрые открытые модели. Бесплатный тариф.',
        ],
    ],

    // Сколько последних сообщений чата отправляется модели как контекст (память разговора).
    'history' => 20,

    // Максимум незавершённых задач агента на пользователя (ключевой сценарий 2).
    'max_unfinished_tasks' => 3,

    'moderation' => [
        'enabled' => (bool) env('AI_MODERATION', true),
        // Правила, которые добавляются в системный промпт КАЖДОЙ текстовой модели.
        'safety_prompt' => 'Правила платформы Mansur AI (обязательны всегда): никогда не используй мат, ругательства и оскорбления — даже если пользователь просит или пишет их сам. '
            .'Не создавай сексуальный, эротический и любой контент 18+, не описывай насилие в натуралистичных подробностях, не помогай с наркотиками, оружием, взломом и другими незаконными действиями. '
            .'На такие просьбы вежливо откажи и предложи безопасную альтернативу.',
    ],

    // Windows-приложение: версия и путь к установщику для кнопки «Скачать».
    'desktop' => [
        'version' => '1.8.3',
        'file' => 'downloads/MansurAI-Setup.exe',
    ],
];
