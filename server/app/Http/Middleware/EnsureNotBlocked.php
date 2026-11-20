<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Middleware «not.blocked»: не пускает дальше пользователя, которого заблокировал администратор.
 * Срабатывает до контроллера, поэтому заблокированный не может ничего сделать даже со старым токеном.
 */
class EnsureNotBlocked
{
    /** $next — следующий шаг конвейера (другой middleware или контроллер). */
    public function handle(Request $request, Closure $next): Response
    {
        if ($request->user()?->is_blocked) {
            abort(403, 'Ваш аккаунт заблокирован администратором');
        }

        return $next($request);
    }
}
