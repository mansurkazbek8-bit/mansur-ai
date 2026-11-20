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
        // Personal design shared by the site and the Windows app.
        Schema::table('users', function (Blueprint $table) {
            $table->jsonb('appearance')->nullable()->after('is_blocked');
            $table->string('background_path')->nullable()->after('appearance');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('users', fn (Blueprint $table) => $table->dropColumn(['appearance', 'background_path']));
    }
};
