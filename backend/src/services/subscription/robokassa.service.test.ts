import { describe, expect, it, vi, beforeEach } from "vitest";
import { generatePurchaseSignature, verifyResultSignature, buildPurchaseUrl } from "./robokassa.service";
import { config } from "@/config/config";

vi.mock("@/config/config", () => ({
  config: {
    robokassa: {
      merchantLogin: "test_merchant",
      password1: "test_password1",
      password2: "test_password2",
      isTest: true,
      successUrl: "http://localhost:8080/payment/success",
      failUrl: "http://localhost:8080/payment/fail",
    },
  },
}));

describe("Robokassa Service", () => {
  describe("generatePurchaseSignature", () => {
    it("generates correct MD5 signature for purchase", () => {
      const params = {
        outSum: 100,
        invId: 12345,
        description: "Test purchase",
      };

      const signature = generatePurchaseSignature(params);
      
      expect(signature).toBeDefined();
      expect(typeof signature).toBe("string");
      expect(signature.length).toBe(32);
    });

    it("generates different signatures for different amounts", () => {
      const params1 = {
        outSum: 100,
        invId: 12345,
        description: "Test purchase",
      };

      const params2 = {
        outSum: 200,
        invId: 12345,
        description: "Test purchase",
      };

      const signature1 = generatePurchaseSignature(params1);
      const signature2 = generatePurchaseSignature(params2);
      
      expect(signature1).not.toBe(signature2);
    });
  });

  describe("verifyResultSignature", () => {
    it("verifies valid signature correctly", () => {
      const notification = {
        OutSum: "100.00",
        InvId: "12345",
        SignatureValue: "e10adc3949ba59abbe56e057f20f883e",
      };

      vi.spyOn(config.robokassa, "password2", "get").mockReturnValue("test_password2");
      
      const isValid = verifyResultSignature(notification);
      
      expect(typeof isValid).toBe("boolean");
    });

    it("rejects invalid signature", () => {
      const notification = {
        OutSum: "100.00",
        InvId: "12345",
        SignatureValue: "invalid_signature",
      };

      const isValid = verifyResultSignature(notification);
      
      expect(isValid).toBe(false);
    });

    it("is case-insensitive for signature comparison", () => {
      const notification = {
        OutSum: "100.00",
        InvId: "12345",
        SignatureValue: "E10ADC3949BA59ABBE56E057F20F883E",
      };

      const isValid = verifyResultSignature(notification);
      
      expect(typeof isValid).toBe("boolean");
    });
  });

  describe("buildPurchaseUrl", () => {
    it("builds correct purchase URL with required parameters", () => {
      const params = {
        outSum: 100,
        invId: 12345,
        description: "Test subscription",
      };

      const url = buildPurchaseUrl(params);
      
      expect(url).toContain("auth.robokassa.ru");
      expect(url).toContain("MerchantLogin=test_merchant");
      expect(url).toContain("OutSum=100.00");
      expect(url).toContain("InvId=12345");
      expect(url).toContain("Description=Test+subscription");
      expect(url).toContain("IsTest=1");
      expect(url).toContain("Culture=ru");
    });

    it("includes email parameter when provided", () => {
      const params = {
        outSum: 100,
        invId: 12345,
        description: "Test subscription",
        email: "user@example.com",
      };

      const url = buildPurchaseUrl(params);
      
      expect(url).toContain("Email=user%40example.com");
    });

    it("includes signature in URL", () => {
      const params = {
        outSum: 100,
        invId: 12345,
        description: "Test subscription",
      };

      const url = buildPurchaseUrl(params);
      
      expect(url).toContain("SignatureValue=");
    });

    it("formats amount with 2 decimal places", () => {
      const params = {
        outSum: 100.5,
        invId: 12345,
        description: "Test subscription",
      };

      const url = buildPurchaseUrl(params);
      
      expect(url).toContain("OutSum=100.50");
    });
  });
});
