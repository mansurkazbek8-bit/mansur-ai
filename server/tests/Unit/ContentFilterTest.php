<?php

namespace Tests\Unit;

use App\Services\ContentFilter;
use Tests\TestCase;

class ContentFilterTest extends TestCase
{
    private ContentFilter $filter;

    protected function setUp(): void
    {
        parent::setUp();
        $this->filter = new ContentFilter;
    }

    public function test_clean_text_passes(): void
    {
        $clean = [
            'Привет! Расскажи о себе и о небе', 'Купил мандарины и мандат депутата', 'Хочу попкорн и кино',
            'Художник нарисовал хутор', 'Сукно для костюма', 'Хлеб, ребус, погибель', 'Член команды разработчиков',
            'Напиши код на Python', 'Как работает нейросеть?', 'Застрахуй машину', 'Голые факты о космосе',
            'Help me write an essay about Shakespeare', 'Sussex and Essex counties', 'grape juice recipe',
            'Учебник по биологии', 'Себя не жалей', 'Оскорблять людей плохо',
        ];
        foreach ($clean as $text) {
            $this->assertNull($this->filter->violation($text), "False positive: {$text}");
        }
    }

    public function test_profanity_is_blocked(): void
    {
        $bad = ['ты хуйня', 'Пиздец какой', 'да ну нах, заебал', 'бля, опять', 'ебать', 'ХУЙ', 'х у й', 'xуй', 'сука ты', 'fuck you', 'what a shit', 'мудак', 'бляяяяя'];
        foreach ($bad as $text) {
            $this->assertNotNull($this->filter->violation($text), "Not caught: {$text}");
        }
    }

    public function test_adult_is_blocked(): void
    {
        foreach (['покажи порно', 'эротический рассказ', 'hentai picture', 'nsfw art', 'секс'] as $text) {
            $this->assertNotNull($this->filter->violation($text), "Not caught: {$text}");
        }
        foreach (['голая девушка', 'naked woman', 'woman in bikini', 'nude model'] as $text) {
            $this->assertNotNull($this->filter->violation($text, image: true), "Image prompt not caught: {$text}");
        }
        $this->assertNull($this->filter->violation('кот в космосе', image: true));
    }

    public function test_censor_masks_swearing_but_keeps_code(): void
    {
        $out = $this->filter->censor("Это пиздец, но вот код:\n```\n\$x = 'хуй';\n```");
        $this->assertStringNotContainsString('пиздец', $out);
        $this->assertStringContainsString('п*****', $out);
        $this->assertStringContainsString("\$x = 'хуй';", $out);
    }
}
