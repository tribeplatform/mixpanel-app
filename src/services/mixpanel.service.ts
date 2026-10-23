import { HttpException } from '@exceptions/HttpException';
import axios from 'axios';
import { createLogger } from '@utils/logger';

// One logger per module: every Logger adds a winston exception handler (an uncaughtException
// listener on process), so creating one per MixpanelService (per webhook) leaked memory.
const logger = createLogger('MixpanelService');

export enum MIXPANEL_REGIONS {
  US = 'US',
  EU = 'EU',
}

class MixpanelService {
  private token = null;
  private region = '';

  constructor(token: string, region: string) {
    this.token = token;
    this.region = region;
  }

  public async track(event) {
    try {
      const url = this.region.toUpperCase() === MIXPANEL_REGIONS.US ? 'https://api.mixpanel.com/track' : 'https://api-eu.mixpanel.com/track';
      if (!event.properties) event.properties = {};
      event.properties.token = this.token;
      // Don't log the payload: it carries the customer's Mixpanel project token.
      logger.log('Send data to Mixpanel', { event: event.event, distinctId: event.properties.distinct_id });
      const result = await axios.get(url, {
        params: {
          verbose: 1,
          data: JSON.stringify(event),
        },
      });
      return result.data;
    } catch (error) {
      logger.error(error);
      throw new HttpException(500, 'Can not send data to amplitude');
    }
  }
  public async setUserProperties(payload) {
    try {
      const url = this.region.toUpperCase() === MIXPANEL_REGIONS.US ? 'https://api.mixpanel.com/engage' : 'https://api-eu.mixpanel.com/engage';
      payload.token = this.token;
      // Don't log the payload: it carries the project token and the member's email and name.
      logger.log('Send user data to Mixpanel', { distinctId: payload.$distinct_id });
      const result = await axios.get(url, {
        params: {
          verbose: 1,
          data: JSON.stringify(payload),
        },
      });
      return result.data;
    } catch (error) {
      logger.error(error);
      throw new HttpException(500, 'Can not send data to amplitude');
    }
  }
}

export default MixpanelService;
