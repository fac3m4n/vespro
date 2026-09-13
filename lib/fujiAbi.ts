import { parseAbi } from "viem";

/**
 * Split out from lib/fuji.ts so the browser can import it.
 *
 * lib/fuji.ts reads FUJI_*_PRIVATE_KEY and builds signing clients; pulling that into a
 * client component to get at the ABI would drag server-only code into the bundle.
 */
export const LICENCE_ABI = parseAbi([
  "function registerTerms(string listingId, uint256 pricePerDayWei, uint64 minSeconds, uint64 maxSeconds, bytes32 schemaCommitment)",
  "function quote(string listingId, uint64 termSeconds) view returns (uint256)",
  "function purchase(string listingId, uint64 termSeconds) payable returns (uint256)",
  "function owed(address account) view returns (uint256)",
  "function withdraw()",
  "function denied(string listingId, address account) view returns (bool)",
  "function setEligibility(string listingId, address account, bool deny)",
  // Returns the Terms struct, so the output is a single tuple rather than six values.
  "function termsFor(string listingId) view returns ((address dataOwner, uint256 pricePerDayWei, uint64 minSeconds, uint64 maxSeconds, bytes32 schemaCommitment, bool active))",
  "event LicencePurchased(uint256 indexed licenceId, string indexed listingId, address indexed buyer, address dataOwner, uint64 termSeconds, uint256 paid)",
]);
