import {
  CanActivate, ExecutionContext, Injectable, ForbiddenException, UnauthorizedException,
  createParamDecorator, SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as jwt from 'jsonwebtoken';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

export interface JwtPayload { sub: string; username: string; role: string; realName: string; }

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const header: string = req.headers['authorization'] || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new UnauthorizedException('缺少登录令牌');
    try {
      req.user = jwt.verify(token, process.env.JWT_SECRET || 'psycare-dev-secret') as JwtPayload;
    } catch {
      throw new UnauthorizedException('令牌无效或已过期');
    }
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      ctx.getHandler(), ctx.getClass(),
    ]);
    if (required && required.length && !required.includes(req.user.role)) {
      throw new ForbiddenException('当前角色无权执行此操作');
    }
    return true;
  }
}

export const CurrentUser = createParamDecorator((_d, ctx: ExecutionContext) =>
  ctx.switchToHttp().getRequest().user as JwtPayload);
