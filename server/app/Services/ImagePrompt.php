<?php

namespace App\Services;

use App\Models\AiModel;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * Перевод запроса картинки в хороший английский промпт.
 * Генераторы изображений понимают короткие английские описания. Запрос «надо изоброжение кошки»
 * (по-русски, с опечаткой и словом «надо») давал случайную картинку, поэтому сначала текстовая нейросеть
 * переписывает его в чистое описание: «a fluffy cat sitting on a windowsill, soft light».
 */
class ImagePrompt
{
    // Системная инструкция для текстовой модели-«переводчика» (на английском — так модели понимают точнее).
    private const INSTRUCTIONS = <<<'TXT'
You write prompts for an image generator. The user asks for a picture in any language, possibly with typos or slang.
Reply with ONE English prompt (at most 60 words) that describes only what must be in the picture: the main subject first, then details, setting, style and lighting.
Remove request words such as "draw", "generate", "make", "I need a picture of". Keep every object, colour and detail the user mentioned and do not add new main subjects.
If earlier requests are given and the new one refers to them (for example "make it red", "now in winter"), combine them into one full description.
Never add text, letters, captions or watermarks. Output only the prompt, without quotes or explanations.
TXT;

    public function __construct(private readonly AiGateway $gateway) {}

    /**
     * Получить английский промпт. Если запрос уже английский и не ссылается на прошлые — без изменений.
     *
     * @param  array<int, string>  $earlier  прошлые запросы картинок в этом чате («а теперь сделай красной»)
     */
    public function english(string $request, array $earlier = []): string
    {
        $request = trim($request);
        // Только ASCII-символы (английский) и нечего объединять — отправляем как есть.
        if (! $earlier && ! preg_match('/[^\x00-\x7F]/u', $request)) {
            return $request;
        }

        $text = ($earlier ? "Earlier requests in this chat:\n- ".implode("\n- ", $earlier)."\n\nNew request: " : 'Request: ').$request;
        $messages = [['role' => 'system', 'content' => self::INSTRUCTIONS], ['role' => 'user', 'content' => $text]];

        // Бесплатные модели часто заняты — пробуем несколько, но не дольше 45 секунд в сумме.
        $started = microtime(true);
        foreach ($this->translators() as $model) {
            if (microtime(true) - $started > 45) {
                break;
            }
            try {
                $reply = $this->gateway->chat($model, $messages, extra: ['temperature' => 0.3, 'max_tokens' => 400], timeout: 20, maxWait: 4);
                $prompt = $this->clean((string) $reply['content']);
                if ($prompt !== '') {
                    return $prompt;
                }
            } catch (AiProviderException $e) {
                Log::info("Image prompt via {$model->provider}/{$model->model} failed: ".$e->getMessage());
            }
        }

        return $request; // никто не ответил — отправляем исходный текст, картинка всё равно будет
    }

    /**
     * Какие текстовые модели пробовать: сначала обычные, потом авто-роутеры (могут выбрать модель модерации),
     * Pollinations — последним: без ключа он отвечает 1 раз в 45 с на весь сервер, а сама картинка
     * тоже генерируется у него.
     *
     * @return iterable<AiModel>
     */
    private function translators(): iterable
    {
        return AiModel::available()->where('type', AiModel::TYPE_TEXT)->get()
            ->reject(fn (AiModel $m) => Providers::exhaustedUntil($m->provider))
            ->sortBy(fn (AiModel $m) => [match (true) {
                $m->provider === 'pollinations' => 2,
                str_contains($m->model, '/free') && ! str_contains($m->model, ':free') => 1, // openrouter/free router
                default => 0,
            }, $m->sort])
            ->unique(fn (AiModel $m) => $m->provider.'/'.$m->model)
            ->take(5);
    }

    /** Почистить ответ модели: убрать размышления <think>, «Prompt:», кавычки; отбросить ответ не по делу. */
    private function clean(string $reply): string
    {
        $reply = preg_replace('/<think>.*?<\/think>/s', '', $reply); // reasoning models
        $line = collect(preg_split('/\R/', $reply))->map(fn ($l) => trim($l))->first(fn ($l) => $l !== '') ?? '';
        $line = preg_replace('/^(image\s+)?prompt\s*:\s*/i', '', $line);
        $line = trim($line, " \t\"'«»`*");

        // Это не описание: снова русский текст, вердикт модерации («User Safety: safe») или пара слов.
        if (preg_match('/\p{Cyrillic}/u', $line) || preg_match('/\b(safety|unsafe)\b/i', $line) || str_word_count($line) < 3) {
            return '';
        }

        return Str::limit($line, 600, '');
    }
}
