import { formatInTimeZone } from "date-fns-tz";
import { v4 as uuid } from "uuid";
import fs from "fs";
import fsPromises from "fs/promises";
import { Request, Response, NextFunction } from "express";

interface LogContent {
  user_id: string;
  user_name: string;
  action: string;
  entity_id: string | null;
  entity_type: string;
  status: "Successful" | "Failed";
  description: string;
}

export const log = async (message: LogContent): Promise<void> => {
  const dateTime = formatInTimeZone(new Date(), "Asia/Dubai", "yyyy-MM-dd\tHH:mm:ss");
  const logItem = `${dateTime}\t${uuid()}\t${message.user_id}\t${
    message.user_name
  }\t${message.action}\t${message.entity_id}\t${message.entity_type}\t${
    message.status
  }\t${message.description}\n`;
  const dir = `./logs/${formatInTimeZone(new Date(), "Asia/Dubai", "MMM_yyyy")}_Logs`;

  try {
    if (!fs.existsSync("./logs")) {
      await fsPromises.mkdir("./logs");
    }
    await fsPromises.appendFile(dir, logItem);
  } catch (err) {
    console.error(err);
  }
};

//  //  Log Template  //  //
/*
  log({
    user_id: req.cookies.employee_id,
    user_name: req.cookies.employee_name,
    action: "",
    entity_type: "",
    entity_id: "",
    status: "",
    description: "",
  });

*/

// export const IELogger = (
//   req: Request,
//   res: Response,
//   next: NextFunction
// ): void => {
//   logImportExport(req.body.message, "IELog.log");
//   next();
// };
