import { CREDENTIALS, NODE_ENV, ORIGIN, PORT } from '@config';
import { connect, set } from 'mongoose';
import { logger } from '@utils/logger';

import { Routes } from '@interfaces/routes.interface';
import bodyParser from 'body-parser';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { dbConnection } from '@databases';
import errorMiddleware from '@middlewares/error.middleware';
import express from 'express';
import helmet from 'helmet';
import hpp from 'hpp';
import path from 'path';
import { setupReactViews } from 'express-tsx-views';

class App {
  public app: express.Application;
  public env: string;
  public port: string | number;

  constructor(routes: { client: Routes[]; server: Routes[] }) {
    this.app = express();
    this.env = NODE_ENV || 'development';
    this.port = PORT || 3000;

    this.connectToDatabase();
    this.initializeMiddlewares();
    this.setViews();
    this.initializeRoutes(routes);
    this.initializeErrorHandling();
  }

  private setViews() {
    setupReactViews(this.app, {
      viewsDirectory: path.join(__dirname, '/views'),
      prettify: true,
    });
  }

  public listen() {
    this.app.listen(this.port, () => {
      logger.log(`=================================`);
      logger.log(`======= ENV: ${this.env} =======`);
      logger.log(`🚀 App listening on the port ${this.port}`);
      logger.log(`=================================`);
    });
  }

  public getServer() {
    return this.app;
  }

  private connectToDatabase() {
    if (this.env !== 'production') {
      set('debug', true);
    }

    if (dbConnection) {
      connect(dbConnection.url, dbConnection.options);
    }
  }

  private initializeMiddlewares() {
    this.app.use(cors({ origin: ORIGIN, credentials: CREDENTIALS }));
    this.app.use(express.static('public'));
    this.app.use(
      bodyParser.json({
        verify: (req, res, buf) => {
          if (req.url.includes('/api/webhook')) req['rawBody'] = buf;
        },
      }),
    );
    this.app.use(hpp());
    this.app.use(helmet());
    this.app.use(compression());
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    this.app.use(cookieParser());
  }

  private initializeRoutes(routes: { client: Routes[]; server: Routes[] }) {
    routes.client.forEach(route => {
      this.app.use('/', route.router);
    });

    routes.server.forEach(route => {
      this.app.use('/api', route.router);
    });
  }

  private initializeErrorHandling() {
    this.app.use(errorMiddleware);
  }
}

export default App;
