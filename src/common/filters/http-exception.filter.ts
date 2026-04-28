import {
  ExceptionFilter, Catch, ArgumentsHost,
  HttpException, HttpStatus, Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Filtre global : formate toutes les erreurs en JSON structuré.
 * Réponse type :
 * {
 *   statusCode: 400,
 *   error: "Bad Request",
 *   message: "Écriture déséquilibrée",
 *   timestamp: "2025-05-01T12:00:00.000Z",
 *   path: "/api/v1/journal/entries"
 * }
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx      = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request  = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse =
      exception instanceof HttpException
        ? exception.getResponse()
        : null;

    const message =
      typeof exceptionResponse === 'object' && exceptionResponse !== null
        ? (exceptionResponse as any).message
        : exception instanceof Error
        ? exception.message
        : 'Erreur interne du serveur';

    // Log côté serveur
    if (status >= 500) {
      this.logger.error(`[${request.method}] ${request.url}`, exception);
    }

    response.status(status).json({
      statusCode: status,
      error:      HttpStatus[status] ?? 'Error',
      message,
      timestamp:  new Date().toISOString(),
      path:       request.url,
    });
  }
}
