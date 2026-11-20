<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    // Providers with their own free key answer steadily, so the agent tries them before the
    // shared free OpenRouter models. Without a key they are skipped automatically.
    private const ORDER = ['gemini-agent' => 25, 'groq-agent' => 26, 'cerebras-agent' => 27];

    /**
     * Run the migrations.
     */
    public function up(): void
    {
        foreach (self::ORDER as $slug => $sort) {
            DB::table('ai_models')->where('slug', $slug)->update(['sort' => $sort, 'updated_at' => now()]);
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        foreach (['gemini-agent' => 36, 'groq-agent' => 35, 'cerebras-agent' => 37] as $slug => $sort) {
            DB::table('ai_models')->where('slug', $slug)->update(['sort' => $sort]);
        }
    }
};
