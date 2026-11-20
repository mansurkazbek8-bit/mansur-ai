<?php

namespace App\Services;

/**
 * Правила платформы: без мата и без контента 18+.
 * violation() проверяет запрос ДО отправки нейросети (лимит не тратится, запрос никуда не уходит — 422),
 * censor() заменяет мат в ответе нейросети на «х**».
 */
class ContentFilter
{
    /** Корни мата (русские и английские) — регулярные выражения, проверяются с начала слова. */
    private const PROFANITY = [
        '(?:за|на|по|от|вы|у|при|раз|до|о|об|под)?ху[йяеёию]', 'хуйн',
        '(?:рас|рос|рас|вы|за|на|по|с|от)?пизд', 'пезд',
        '(?:за|на|по|от|вы|у|при|раз|до|про|подъ|объ|разъ|въ)?еб(?:а|у|л|ну|ош|ыр|ыв|ть|ет|ут|ись|ан)', 'еблан', 'ебуч',
        'бля(?:д|т|ть|ха)?', 'блят', 'блиад',
        'мудак', 'мудил', 'мудозвон', 'гандон', 'гондон', 'пидор', 'пидар', 'пидр', 'педик',
        'залуп', 'шлюх', 'шалав', 'манда$', 'манды$', 'мандавош', 'дроч', 'сучк', 'сука', 'суки', 'сучар', 'долбоеб', 'долбаеб', 'уеб',
        'fuck', 'fck', 'shit', 'bitch', 'cunt', 'asshole', 'motherf', 'dickhead', 'whore', 'slut', 'nigg',
    ];

    /** Слова явных запросов 18+ (запрещены везде). */
    private const ADULT = [
        'порн', 'эротич', 'хентай', 'минет', 'оргазм', 'изнасил', 'педофил', 'инцест', 'проститу', 'стриптиз', 'секс(?:уальн|а$|ом$|е$|$)',
        'porn', 'nsfw', 'hentai', 'erotic', 'orgasm', 'onlyfans', 'xxx', 'bdsm', 'fetish', 'rape$', 'raping', 'incest', 'blowjob', 'sex$', 'sexual', 'sexy',
    ];

    /** Дополнительно запрещены в запросах КАРТИНОК (нагота, части тела). */
    private const ADULT_IMAGE = [
        'голая', 'голый', 'голые', 'голую', 'голых', 'обнаж', 'нагая', 'нагой', 'нагие', 'наготу', 'раздет', 'раздень', 'интим', 'эрот', 'секс',
        'вагин', 'пенис', 'сиськ', 'титьк', 'грудь$', 'груди$', 'ягодиц', 'бикини', 'купальник', 'белье$', 'трусы', 'трусик',
        'nude', 'nudity', 'naked', 'topless', 'lingerie', 'boobs', 'tits', 'nipple', 'genital', 'penis', 'vagina', 'undress', 'bikini', 'underwear', 'breast', 'butt$', 'sex',
    ];

    /** Похожие латинские буквы и цифры, которыми пытаются обойти фильтр («xyй», «3ло» → кириллица). */
    private const LOOKALIKE = [
        'a' => 'а', 'b' => 'б', 'c' => 'с', 'e' => 'е', 'k' => 'к', 'm' => 'м', 'o' => 'о', 'p' => 'р', 'x' => 'х', 'y' => 'у', 'h' => 'н',
        '0' => 'о', '3' => 'з', '6' => 'б', '@' => 'а', 'ё' => 'е',
    ];

    /** Включена ли модерация (AI_MODERATION в .env). */
    public function enabled(): bool
    {
        return (bool) config('ai.moderation.enabled');
    }

    /**
     * Проверить запрос пользователя.
     *
     * @return string|null причина отказа или null, если текст допустим
     */
    public function violation(string $text, bool $image = false): ?string
    {
        if (! $this->enabled()) {
            return null;
        }
        if ($this->matches($text, $image ? [...self::ADULT, ...self::ADULT_IMAGE] : self::ADULT)) {
            return 'Запрос содержит контент 18+, это запрещено правилами Mansur AI.';
        }
        if ($this->matches($text, self::PROFANITY)) {
            return 'Пожалуйста, без нецензурной лексики — это запрещено правилами Mansur AI.';
        }

        return null;
    }

    public function hasProfanity(string $text): bool
    {
        return $this->matches($text, self::PROFANITY);
    }

    public function isAdult(string $text, bool $image = false): bool
    {
        return $this->matches($text, $image ? [...self::ADULT, ...self::ADULT_IMAGE] : self::ADULT);
    }

    /** Заменить мат в ответе нейросети на «х**». Блоки кода ``` не трогаем, чтобы не сломать программу. */
    public function censor(string $text): string
    {
        if (! $this->enabled()) {
            return $text;
        }

        $parts = preg_split('/(```.*?```)/s', $text, -1, PREG_SPLIT_DELIM_CAPTURE);

        return implode('', array_map(function ($part) {
            if (str_starts_with($part, '```')) {
                return $part;
            }

            return preg_replace_callback('/[\p{L}\d@]+/u', function ($m) {
                $word = $m[0];

                return $this->wordMatches($this->normalize($word), self::PROFANITY)
                    ? mb_substr($word, 0, 1).str_repeat('*', max(2, mb_strlen($word) - 1))
                    : $word;
            }, $part);
        }, $parts));
    }

    /** Есть ли в тексте хотя бы одно слово, начинающееся с запрещённого корня. */
    private function matches(string $text, array $roots): bool
    {
        $words = preg_split('/[^\p{L}\d@]+/u', $this->normalize($text), -1, PREG_SPLIT_NO_EMPTY);
        foreach ($words as $word) {
            if ($this->wordMatches($word, $roots)) {
                return true;
            }
        }

        // Обход «х у й», «х.у.й» — буквы через пробелы или точки склеиваем и проверяем ещё раз.
        if (preg_match_all('/(?:^|\s)((?:\p{L}[\s.\-_*]){2,}\p{L})(?=\s|$)/u', $this->normalize($text), $m)) {
            foreach ($m[1] as $spaced) {
                if ($this->wordMatches(preg_replace('/[\s.\-_*]/u', '', $spaced), $roots)) {
                    return true;
                }
            }
        }

        return false;
    }

    private function wordMatches(string $word, array $roots): bool
    {
        foreach ($roots as $root) {
            if (preg_match('/^'.$root.'/u', $word)) {
                return true;
            }
        }

        return false;
    }

    /** Нормализация: нижний регистр, ё→е, похожие латинские буквы → кириллица, «бляяяя» → «бля». */
    private function normalize(string $text): string
    {
        $text = mb_strtolower($text);
        $text = str_replace('ё', 'е', $text);

        // Замену латиницы делаем только в словах с кириллицей, чтобы английские слова не портились.
        $text = preg_replace_callback('/[\p{L}\d@]+/u', function ($m) {
            $w = $m[0];
            if (preg_match('/\p{Cyrillic}/u', $w)) {
                $w = strtr($w, self::LOOKALIKE);
            }

            return preg_replace('/(.)\1{2,}/u', '$1', $w); // "бляяяя" → "бля"
        }, $text);

        return $text;
    }
}
