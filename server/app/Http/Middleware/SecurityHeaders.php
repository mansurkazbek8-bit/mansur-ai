<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Защитные HTTP-заголовки для публичного сайта. Добавляются к КАЖДОМУ ответу сервера.
 * Защищают от встраивания сайта в чужую страницу (clickjacking), подмены типа файла и утечки адресов.
 */
class SecurityHeaders
{
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request); // сначала получаем готовый ответ, потом дописываем заголовки
        $h = $response->headers;
        $h->set('X-Content-Type-Options', 'nosniff');                    // браузер не «угадывает» тип файла
        $h->set('X-Frame-Options', 'SAMEORIGIN');                        // сайт нельзя вставить в iframe чужого сайта
        $h->set('Referrer-Policy', 'strict-origin-when-cross-origin');   // чужим сайтам не уходит полный адрес страницы
        // В чате есть голосовой ввод, поэтому разрешён только микрофон и только для нашего сайта.
        $h->set('Permissions-Policy', 'camera=(), geolocation=(), microphone=(self), payment=()');
        if ($request->isSecure()) {
            // HSTS: браузер год открывает сайт только по HTTPS.
            $h->set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        }

        return $response;
    }
}
