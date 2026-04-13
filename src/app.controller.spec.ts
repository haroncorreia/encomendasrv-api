import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { description, version } from '../package.json';

describe('AppController', () => {
  let appController: AppController;
  const appServiceMock = {
    getHello: jest.fn(() => `${description} v${version} - Online`),
  };

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [{ provide: AppService, useValue: appServiceMock }],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return API online message', () => {
      expect(appController.getHello()).toBe(
        `${description} v${version} - Online`,
      );
    });
  });
});
