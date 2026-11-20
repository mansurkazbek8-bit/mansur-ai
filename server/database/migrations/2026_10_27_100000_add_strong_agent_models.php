<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    // Big free models that can call tools: the agent tries them first and falls back to the others.
    private const MODELS = [
        [
            'slug' => 'openrouter-agent-nemotron', 'name' => 'Mansur Agent (Nemotron 550B)', 'provider' => 'openrouter',
            'model' => 'nvidia/nemotron-3-ultra-550b-a55b:free', 'type' => 'agent', 'daily_limit' => 500, 'sort' => 30,
            'description' => 'Сильная модель агента: лучше пишет код и сайты',
        ],
        [
            'slug' => 'openrouter-agent-north', 'name' => 'Mansur Agent (North Code)', 'provider' => 'openrouter',
            'model' => 'cohere/north-mini-code:free', 'type' => 'agent', 'daily_limit' => 500, 'sort' => 31,
            'description' => 'Запасная модель агента для кода',
        ],
    ];

    /**
     * Run the migrations.
     */
    public function up(): void
    {
        foreach (self::MODELS as $m) {
            if (! DB::table('ai_models')->where('slug', $m['slug'])->exists()) {
                DB::table('ai_models')->insert([...$m, 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
            }
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        DB::table('ai_models')->whereIn('slug', array_column(self::MODELS, 'slug'))->delete();
    }
};
