import { Body, Controller, Get, Put, Post, Delete, Param, UseGuards, BadRequestException } from '@nestjs/common';
import type { IUser } from '@memecoinbot/db';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import {
  SettingsService,
  type AppSettings,
  type RiskSettingsState,
} from './settings.service';

@Controller()
@UseGuards(AuthGuard)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get('settings')
  async getSettings(@CurrentUser() user: IUser) {
    await this.settingsService.hydrateFromUser(user);
    return this.settingsService.getSettings();
  }

  @Put('settings')
  async putSettings(
    @CurrentUser() user: IUser,
    @Body() body: Partial<AppSettings>,
  ) {
    await this.settingsService.hydrateFromUser(user);
    const settings = this.settingsService.updateSettings(body);
    await this.settingsService.persistToUser(user);
    return settings;
  }

  @Get('risk')
  async getRisk(@CurrentUser() user: IUser) {
    await this.settingsService.hydrateFromUser(user);
    return this.settingsService.getRisk();
  }

  @Put('risk')
  async putRisk(
    @CurrentUser() user: IUser,
    @Body() body: Partial<RiskSettingsState>,
  ) {
    await this.settingsService.hydrateFromUser(user);
    const risk = this.settingsService.updateRisk(body);
    await this.settingsService.persistToUser(user);
    return risk;
  }

  @Post('settings/reset')
  async reset(@CurrentUser() user: IUser) {
    const out = this.settingsService.resetDefaults();
    await this.settingsService.persistToUser(user);
    return out;
  }

  @Get('settings/smart-wallets')
  async listSmartWallets(@CurrentUser() user: IUser) {
    await this.settingsService.hydrateFromUser(user);
    return this.settingsService.listSmartWallets();
  }

  @Post('settings/smart-wallets')
  async addSmartWallet(
    @CurrentUser() user: IUser,
    @Body() body: { address: string; label?: string },
  ) {
    await this.settingsService.hydrateFromUser(user);
    try {
      const settings = this.settingsService.addTrackedWallet(body.address, body.label);
      await this.settingsService.persistToUser(user);
      return { settings, wallets: this.settingsService.listSmartWallets() };
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : 'Could not add wallet',
      );
    }
  }

  @Delete('settings/smart-wallets/:address')
  async removeSmartWallet(
    @CurrentUser() user: IUser,
    @Param('address') address: string,
  ) {
    await this.settingsService.hydrateFromUser(user);
    const settings = this.settingsService.removeTrackedWallet(address);
    await this.settingsService.persistToUser(user);
    return { settings, wallets: this.settingsService.listSmartWallets() };
  }

  @Post('trading/kill-switch')
  async setKillSwitch(
    @CurrentUser() user: IUser,
    @Body() body: { on?: boolean },
  ) {
    await this.settingsService.hydrateFromUser(user);
    const on = body.on !== false;
    const settings = this.settingsService.setKillSwitch(on);
    await this.settingsService.persistToUser(user);
    return settings;
  }

  @Post('trading/emergency-stop')
  async emergencyStop(@CurrentUser() user: IUser) {
    await this.settingsService.hydrateFromUser(user);
    const settings = this.settingsService.activateEmergencyStop();
    await this.settingsService.persistToUser(user);
    return {
      settings,
      message:
        'Emergency stop activated. Auto trading disabled. New real trades blocked. Positions not auto-closed.',
    };
  }

  @Post('trading/emergency-stop/clear')
  async clearEmergencyStop(@CurrentUser() user: IUser) {
    await this.settingsService.hydrateFromUser(user);
    const settings = this.settingsService.clearEmergencyStop();
    await this.settingsService.persistToUser(user);
    return settings;
  }
}
