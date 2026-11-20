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
        // Paid agent slots: slot 1 is free for everyone, slots 2–5 are bought once.
        Schema::create('agent_purchases', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->unsignedTinyInteger('slot');
            $table->unsignedInteger('amount');
            $table->string('currency', 3)->default('KZT');
            $table->string('provider', 20); // demo | admin | payment gateway name
            $table->string('status', 20)->default('paid'); // pending | paid
            $table->timestamp('paid_at')->nullable();
            $table->timestamps();
            $table->unique(['user_id', 'slot']);
        });

        // Which agent of the team runs the task.
        Schema::table('agent_tasks', function (Blueprint $table) {
            $table->unsignedTinyInteger('agent_slot')->nullable()->after('status');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('agent_tasks', fn (Blueprint $table) => $table->dropColumn('agent_slot'));
        Schema::dropIfExists('agent_purchases');
    }
};
