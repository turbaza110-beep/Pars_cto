import * as crypto from "node:crypto";
import { config } from "@/config/config";

export interface RobokassaPurchaseParams {
  outSum: number;
  invId: number;
  description: string;
  email?: string;
  culture?: string;
  encoding?: string;
}

export interface RobokassaResultNotification {
  OutSum: string;
  InvId: string;
  SignatureValue: string;
  [key: string]: string;
}

function md5(text: string): string {
  return crypto.createHash("md5").update(text, "utf8").digest("hex");
}

export function generatePurchaseSignature(params: RobokassaPurchaseParams): string {
  const { merchantLogin, password1 } = config.robokassa;
  const { outSum, invId, description } = params;
  
  const signatureString = `${merchantLogin}:${outSum}:${invId}:${password1}`;
  return md5(signatureString);
}

export function verifyResultSignature(notification: RobokassaResultNotification): boolean {
  const { merchantLogin, password2 } = config.robokassa;
  const { OutSum, InvId, SignatureValue } = notification;
  
  const expectedSignatureString = `${OutSum}:${InvId}:${password2}`;
  const expectedSignature = md5(expectedSignatureString);
  
  return expectedSignature.toLowerCase() === SignatureValue.toLowerCase();
}

export function buildPurchaseUrl(params: RobokassaPurchaseParams): string {
  const { merchantLogin, isTest } = config.robokassa;
  const { outSum, invId, description, email, culture = "ru", encoding = "utf-8" } = params;
  
  const signature = generatePurchaseSignature(params);
  
  const baseUrl = isTest
    ? "https://auth.robokassa.ru/Merchant/Index.aspx"
    : "https://auth.robokassa.ru/Merchant/Index.aspx";
  
  const urlParams = new URLSearchParams({
    MerchantLogin: merchantLogin,
    OutSum: outSum.toFixed(2),
    InvId: invId.toString(),
    Description: description,
    SignatureValue: signature,
    Culture: culture,
    Encoding: encoding,
    IsTest: isTest ? "1" : "0",
  });
  
  if (email) {
    urlParams.append("Email", email);
  }
  
  return `${baseUrl}?${urlParams.toString()}`;
}

export function buildReceiptUrl(invId: number): string {
  const { merchantLogin, isTest } = config.robokassa;
  
  const baseUrl = isTest
    ? "https://auth.robokassa.ru/Merchant/WebService/Service.asmx/OpStateExt"
    : "https://auth.robokassa.ru/Merchant/WebService/Service.asmx/OpStateExt";
  
  const urlParams = new URLSearchParams({
    MerchantLogin: merchantLogin,
    InvoiceID: invId.toString(),
  });
  
  return `${baseUrl}?${urlParams.toString()}`;
}
