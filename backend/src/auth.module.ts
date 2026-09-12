import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Controller, Post, Body, Get, UseGuards } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { User } from './entities';
import { AuthGuard, CurrentUser, JwtPayload } from './auth.guard';

export class LoginDto {
  username: string; password: string;
}

@Controller('auth')
export class AuthController {
  constructor(@InjectRepository(User) private users: Repository<User>) {}

  @Post('login')
  async login(@Body() dto: LoginDto) {
    const user = await this.users.findOne({
      where: { username: dto.username },
      relations: ['counselorProfile'],
    });
    if (!user || !user.active || !bcrypt.compareSync(dto.password || '', user.passwordHash)) {
      return { ok: false, message: '用户名或密码错误' };
    }
    const payload: JwtPayload = {
      sub: user.id, username: user.username, role: user.role, realName: user.realName,
    };
    const token = jwt.sign(payload, process.env.JWT_SECRET || 'psycare-dev-secret', {
      expiresIn: '12h',
    });
    return {
      ok: true, token,
      user: {
        id: user.id, username: user.username, realName: user.realName, role: user.role,
        phone: user.phone, community: user.community,
        counselorProfile: user.counselorProfile || null,
      },
    };
  }

  @UseGuards(AuthGuard)
  @Get('me')
  me(@CurrentUser() u: JwtPayload) {
    return u;
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [AuthController],
})
export class AuthModule {}
