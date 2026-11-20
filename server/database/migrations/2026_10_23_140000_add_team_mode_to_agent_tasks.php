<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        // "Together" mode: the lead agent splits a task into subtasks that other agents run in parallel.
        Schema::table('agent_tasks', function (Blueprint $table) {
            $table->string('mode', 10)->default('solo')->after('workspace'); // solo | team
            $table->foreignId('parent_id')->nullable()->after('user_id')->constrained('agent_tasks')->cascadeOnDelete();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('agent_tasks', function (Blueprint $table) {
            $table->dropConstrainedForeignId('parent_id');
            $table->dropColumn('mode');
        });
    }
};
