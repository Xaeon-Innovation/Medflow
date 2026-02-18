import { formatInTimeZone } from "date-fns-tz";
import { v4 as uuid } from "uuid";
import fs from "fs";
import fsPromises from "fs/promises";
import { Request, Response, NextFunction } from "express";

export const logEvents = async (message: string): Promise<void> => {
  const dateTime = formatInTimeZone(new Date(), "Asia/Dubai", "yyyy-MM-dd\tHH:mm:ss");
  const logItem = `${dateTime}\t${uuid()}\t${message}\n`;
  const dir = `../logs/${formatInTimeZone(new Date(), "Asia/Dubai", "MMM_yyyy")}_Request_Logs`;

  try {
    if (!fs.existsSync("../logs")) {
      await fsPromises.mkdir("../logs");
    }
    await fsPromises.appendFile(dir, logItem);
  } catch (err) {
    console.error(err);
  }
};

export const logger = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  logEvents(`${req.method}\t${req.url}\t${req.headers.origin ?? "unknown"}`);
  next();
};
