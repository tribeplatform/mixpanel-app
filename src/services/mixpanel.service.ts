import { HttpException } from '@exceptions/HttpException';
import axios from 'axios';
import { createLogger } from '@utils/logger';
import { Logger } from '@tribeplatform/node-logger';

export enum MIXPANEL_REGIONS {
  US = 'US',
  EU = 'EU',
}

class MixpanelService {
  private readonly logger: Logger;
  private token = null;
  private region = '';

  constructor(token: string, region: string) {
    this.token = token;
    this.region = region;
    this.logger = createLogger(MixpanelService.name);
  }

  public async track(event) {
    try {
      const url = this.region.toUpperCase() === MIXPANEL_REGIONS.US ? 'https://api.mixpanel.com/track' : 'https://api-eu.mixpanel.com/track';
      if (!event.properties) event.properties = {};
      event.properties.token = this.token;
      this.logger.log('Send data to Mixpanel: ' + JSON.stringify(event));
      const result = await axios.get(url, {
        params: {
          verbose: 1,
          data: JSON.stringify(event),
        },
      });
      return result.data;
    } catch (error) {
      this.logger.error(error);
      throw new HttpException(500, 'Can not send data to amplitude');
    }
  }
  public async setUserProperties(payload) {
    try {
      const url = this.region.toUpperCase() === MIXPANEL_REGIONS.US ? 'https://api.mixpanel.com/engage' : 'https://api-eu.mixpanel.com/engage';
      payload.token = this.token;
      this.logger.log('Send user data to Mixpanel: ' + JSON.stringify(payload));
      const result = await axios.get(url, {
        params: {
          verbose: 1,
          data: JSON.stringify(payload),
        },
      });
      return result.data;
    } catch (error) {
      this.logger.error(error);
      throw new HttpException(500, 'Can not send data to amplitude');
    }
  }
}

export default MixpanelService;
