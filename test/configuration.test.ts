import { Configuration } from "../src/configuration";

// Snapshot the original env before any test mutates it.
const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  // Restore env vars after each test.
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, ORIGINAL_ENV);
});

describe("Configuration", () => {
  describe("defaults (no env vars set)", () => {
    beforeEach(() => {
      delete process.env["TRACELIT_API_KEY"];
      delete process.env["TRACELIT_SERVICE_NAME"];
      delete process.env["TRACELIT_ENVIRONMENT"];
      delete process.env["TRACELIT_ENDPOINT"];
      delete process.env["TRACELIT_SAMPLE_RATE"];
      delete process.env["TRACELIT_ENABLED"];
    });

    it("defaults apiKey to undefined", () => {
      expect(new Configuration().apiKey).toBeUndefined();
    });

    it("defaults serviceName to undefined", () => {
      expect(new Configuration().serviceName).toBeUndefined();
    });

    it("defaults environment to 'production'", () => {
      expect(new Configuration().environment).toBe("production");
    });

    it("defaults endpoint to the Tracelit ingest URL", () => {
      expect(new Configuration().endpoint).toBe("https://ingest.tracelit.app");
    });

    it("defaults sampleRate to 1.0", () => {
      expect(new Configuration().sampleRate).toBe(1.0);
    });

    it("defaults enabled to true", () => {
      expect(new Configuration().enabled).toBe(true);
    });

    it("defaults resourceAttributes to an empty object", () => {
      expect(new Configuration().resourceAttributes).toEqual({});
    });
  });

  describe("environment variable resolution", () => {
    it("reads apiKey from TRACELIT_API_KEY", () => {
      process.env["TRACELIT_API_KEY"] = "tl_live_abc123";
      expect(new Configuration().apiKey).toBe("tl_live_abc123");
    });

    it("reads serviceName from TRACELIT_SERVICE_NAME", () => {
      process.env["TRACELIT_SERVICE_NAME"] = "my-service";
      expect(new Configuration().serviceName).toBe("my-service");
    });

    it("reads environment from TRACELIT_ENVIRONMENT", () => {
      process.env["TRACELIT_ENVIRONMENT"] = "staging";
      expect(new Configuration().environment).toBe("staging");
    });

    it("reads endpoint from TRACELIT_ENDPOINT", () => {
      process.env["TRACELIT_ENDPOINT"] = "https://self-hosted.example.com";
      expect(new Configuration().endpoint).toBe(
        "https://self-hosted.example.com",
      );
    });

    it("reads sampleRate from TRACELIT_SAMPLE_RATE", () => {
      process.env["TRACELIT_SAMPLE_RATE"] = "0.25";
      expect(new Configuration().sampleRate).toBe(0.25);
    });

    it("disables when TRACELIT_ENABLED is 'false'", () => {
      process.env["TRACELIT_ENABLED"] = "false";
      expect(new Configuration().enabled).toBe(false);
    });

    it("remains enabled for any value other than 'false' (e.g. '0')", () => {
      process.env["TRACELIT_ENABLED"] = "0";
      expect(new Configuration().enabled).toBe(true);
    });

    it("remains enabled for the string 'true'", () => {
      process.env["TRACELIT_ENABLED"] = "true";
      expect(new Configuration().enabled).toBe(true);
    });

    it("falls back to 1.0 when TRACELIT_SAMPLE_RATE is not a number", () => {
      process.env["TRACELIT_SAMPLE_RATE"] = "not-a-number";
      expect(new Configuration().sampleRate).toBe(1.0);
    });
  });

  describe("programmatic values override env vars", () => {
    it("programmatic apiKey overrides env var", () => {
      process.env["TRACELIT_API_KEY"] = "from-env";
      const config = new Configuration();
      config.apiKey = "from-code";
      expect(config.apiKey).toBe("from-code");
    });

    it("programmatic sampleRate overrides env var", () => {
      process.env["TRACELIT_SAMPLE_RATE"] = "0.5";
      const config = new Configuration();
      config.sampleRate = 0.1;
      expect(config.sampleRate).toBe(0.1);
    });
  });

  describe("validate()", () => {
    function validConfig(): Configuration {
      const c = new Configuration();
      c.apiKey = "tl_live_abc123";
      c.serviceName = "test-service";
      return c;
    }

    it("does not throw when all required fields are valid", () => {
      expect(() => validConfig().validate()).not.toThrow();
    });

    it("throws when apiKey is undefined", () => {
      const c = validConfig();
      c.apiKey = undefined;
      expect(() => c.validate()).toThrow(/apiKey is required/);
    });

    it("throws when apiKey is an empty string", () => {
      const c = validConfig();
      c.apiKey = "";
      expect(() => c.validate()).toThrow(/apiKey is required/);
    });

    it("does not throw when serviceName is undefined (falls back to defaults)", () => {
      const c = validConfig();
      c.serviceName = undefined;
      expect(() => c.validate()).not.toThrow();
    });

    it("does not throw when serviceName is an empty string", () => {
      const c = validConfig();
      c.serviceName = "";
      expect(() => c.validate()).not.toThrow();
    });

    it("throws when sampleRate is below 0.0", () => {
      const c = validConfig();
      c.sampleRate = -0.01;
      expect(() => c.validate()).toThrow(/sampleRate must be between/);
    });

    it("throws when sampleRate is above 1.0", () => {
      const c = validConfig();
      c.sampleRate = 1.01;
      expect(() => c.validate()).toThrow(/sampleRate must be between/);
    });

    it("accepts boundary value 0.0", () => {
      const c = validConfig();
      c.sampleRate = 0.0;
      expect(() => c.validate()).not.toThrow();
    });

    it("accepts boundary value 1.0", () => {
      const c = validConfig();
      c.sampleRate = 1.0;
      expect(() => c.validate()).not.toThrow();
    });
  });

  describe("resolvedServiceName()", () => {
    it("returns the explicit serviceName when set", () => {
      const c = new Configuration();
      c.serviceName = "explicit-name";
      expect(c.resolvedServiceName()).toBe("explicit-name");
    });

    it("trims whitespace from serviceName", () => {
      const c = new Configuration();
      c.serviceName = "  my-service  ";
      expect(c.resolvedServiceName()).toBe("my-service");
    });

    it("falls back to 'unknown-service' when serviceName is undefined", () => {
      const c = new Configuration();
      c.serviceName = undefined;
      expect(c.resolvedServiceName()).toBe("unknown-service");
    });

    it("falls back to 'unknown-service' when serviceName is empty string", () => {
      const c = new Configuration();
      c.serviceName = "";
      expect(c.resolvedServiceName()).toBe("unknown-service");
    });

    it("falls back to 'unknown-service' when serviceName is whitespace only", () => {
      const c = new Configuration();
      c.serviceName = "   ";
      expect(c.resolvedServiceName()).toBe("unknown-service");
    });
  });

  describe("baseEndpoint", () => {
    it("strips a trailing slash from the endpoint", () => {
      const c = new Configuration();
      c.endpoint = "https://ingest.tracelit.app/";
      expect(c.baseEndpoint).toBe("https://ingest.tracelit.app");
    });

    it("strips multiple trailing slashes", () => {
      const c = new Configuration();
      c.endpoint = "https://ingest.tracelit.app///";
      expect(c.baseEndpoint).toBe("https://ingest.tracelit.app");
    });

    it("leaves a non-slash-terminated endpoint unchanged", () => {
      const c = new Configuration();
      c.endpoint = "https://ingest.tracelit.app";
      expect(c.baseEndpoint).toBe("https://ingest.tracelit.app");
    });
  });

  describe("exportHeaders()", () => {
    it("returns Authorization, X-Service-Name, and X-Environment headers", () => {
      const c = new Configuration();
      c.apiKey = "tl_key_xyz";
      c.serviceName = "payments-api";
      c.environment = "production";

      const headers = c.exportHeaders();
      expect(headers["Authorization"]).toBe("Bearer tl_key_xyz");
      expect(headers["X-Service-Name"]).toBe("payments-api");
      expect(headers["X-Environment"]).toBe("production");
    });

    it("uses resolved service name in X-Service-Name when serviceName is unset", () => {
      const c = new Configuration();
      c.apiKey = "tl_key";
      c.serviceName = undefined;
      expect(c.exportHeaders()["X-Service-Name"]).toBe("unknown-service");
    });
  });
});
