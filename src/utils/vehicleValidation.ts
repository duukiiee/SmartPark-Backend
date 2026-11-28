/**
 * Vehicle Data Sanitization & Validation Utilities
 * 
 * Ensures that brand, model, and color fields are always properly validated
 * and have meaningful fallback values when processing gate registrations.
 */

/**
 * Sanitizes and validates vehicle brand
 * 
 * Rules:
 * - Must be non-empty after trimming
 * - Max 50 characters
 * - Cannot be just whitespace
 * 
 * @param brand - Input brand string
 * @param model - Fallback model string to extract brand from if needed
 * @returns Sanitized brand or throws error if invalid
 */
export function sanitizeBrand(brand: string | undefined, model: string): string {
  if (!brand) {
    throw new Error("MISSING_BRAND: Brand is required for gate registration");
  }

  const trimmedBrand = brand.trim();

  if (!trimmedBrand) {
    throw new Error("EMPTY_BRAND: Brand cannot be empty or whitespace only");
  }

  if (trimmedBrand.length > 50) {
    throw new Error("BRAND_TOO_LONG: Brand must be 50 characters or less");
  }

  return trimmedBrand;
}

/**
 * Sanitizes and validates vehicle model
 * 
 * Rules:
 * - Must be non-empty after trimming
 * - Max 50 characters
 * - Cannot be just whitespace
 * 
 * @param model - Input model string
 * @returns Sanitized model or throws error if invalid
 */
export function sanitizeModel(model: string): string {
  if (!model) {
    throw new Error("MISSING_MODEL: Model is required for gate registration");
  }

  const trimmedModel = model.trim();

  if (!trimmedModel) {
    throw new Error("EMPTY_MODEL: Model cannot be empty or whitespace only");
  }

  if (trimmedModel.length > 50) {
    throw new Error("MODEL_TOO_LONG: Model must be 50 characters or less");
  }

  return trimmedModel;
}

/**
 * Sanitizes and validates vehicle color
 * 
 * Rules:
 * - Must be non-empty after trimming
 * - Max 30 characters
 * - Cannot be just whitespace
 * 
 * @param color - Input color string
 * @returns Sanitized color or throws error if invalid
 */
export function sanitizeColor(color: string | undefined): string {
  if (!color) {
    throw new Error("MISSING_COLOR: Color is required for gate registration");
  }

  const trimmedColor = color.trim();

  if (!trimmedColor) {
    throw new Error("EMPTY_COLOR: Color cannot be empty or whitespace only");
  }

  if (trimmedColor.length > 30) {
    throw new Error("COLOR_TOO_LONG: Color must be 30 characters or less");
  }

  return trimmedColor;
}

/**
 * Validates vehicle data before database storage
 * 
 * This is the final validation gate before storing vehicle in database.
 * Ensures no empty or invalid values slip through.
 * 
 * @param data - Vehicle data object to validate
 * @throws Error if any field is invalid
 */
export function validateVehicleData(data: {
  brand: string;
  model: string;
  color: string;
  ownerName: string;
  plateNumber: string;
}): void {
  // Validate brand
  if (!data.brand || !data.brand.trim()) {
    throw new Error("INVALID_VEHICLE_DATA: Brand cannot be empty");
  }

  // Validate model
  if (!data.model || !data.model.trim()) {
    throw new Error("INVALID_VEHICLE_DATA: Model cannot be empty");
  }

  // Validate color
  if (!data.color || !data.color.trim()) {
    throw new Error("INVALID_VEHICLE_DATA: Color cannot be empty");
  }

  // Validate owner name
  if (!data.ownerName || !data.ownerName.trim()) {
    throw new Error("INVALID_VEHICLE_DATA: Owner name cannot be empty");
  }

  // Validate plate number
  if (!data.plateNumber || !data.plateNumber.trim()) {
    throw new Error("INVALID_VEHICLE_DATA: Plate number cannot be empty");
  }

  // Check length constraints
  if (data.brand.length > 50) {
    throw new Error("INVALID_VEHICLE_DATA: Brand exceeds maximum length");
  }

  if (data.model.length > 50) {
    throw new Error("INVALID_VEHICLE_DATA: Model exceeds maximum length");
  }

  if (data.color.length > 30) {
    throw new Error("INVALID_VEHICLE_DATA: Color exceeds maximum length");
  }
}

/**
 * Error messages for user-friendly responses
 */
export const VEHICLE_VALIDATION_ERRORS = {
  MISSING_BRAND: "Vehicle brand is required. Please enter the vehicle brand.",
  EMPTY_BRAND: "Vehicle brand cannot be empty or contain only spaces.",
  BRAND_TOO_LONG: "Vehicle brand is too long. Maximum 50 characters allowed.",
  MISSING_MODEL: "Vehicle model is required. Please enter the vehicle model.",
  EMPTY_MODEL: "Vehicle model cannot be empty or contain only spaces.",
  MODEL_TOO_LONG: "Vehicle model is too long. Maximum 50 characters allowed.",
  MISSING_COLOR: "Vehicle color is required. Please enter the vehicle color.",
  EMPTY_COLOR: "Vehicle color cannot be empty or contain only spaces.",
  COLOR_TOO_LONG: "Vehicle color is too long. Maximum 30 characters allowed.",
  INVALID_VEHICLE_DATA: "Vehicle data contains invalid fields. Please check all required fields are filled correctly.",
};

/**
 * Map error codes to user-friendly messages
 */
export function getVehicleValidationErrorMessage(errorMessage: string): string {
  for (const [key, message] of Object.entries(VEHICLE_VALIDATION_ERRORS)) {
    if (errorMessage.includes(key)) {
      return message;
    }
  }
  return VEHICLE_VALIDATION_ERRORS.INVALID_VEHICLE_DATA;
}
