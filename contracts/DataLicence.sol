// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title DataLicence — issuing and settling time-limited licences to private datasets
/// @notice A data licence is a financial right with a lifecycle, so this contract is
/// organised around the three things such a right needs: a rule that defines it, a
/// policy that decides who may hold it, and settlement that pays for it.
///
/// What is deliberately *not* here: the licence's own expiry. The term is recorded and
/// enforced for settlement, but the authoritative access check lives in Arkiv, where a
/// grant entity's lifetime is the term. Duplicating expiry in both places would create
/// two clocks that can disagree, so this contract owns the money and Arkiv owns the
/// access.
contract DataLicence {
    // ---------------------------------------------------------------------
    // The asset rule — what a licence to this dataset is, and what it costs
    // ---------------------------------------------------------------------

    struct Terms {
        address dataOwner;
        uint256 pricePerDayWei;
        uint64 minSeconds;
        uint64 maxSeconds;
        bytes32 schemaCommitment; // hash of the column schema, never the data
        bool active;
    }

    /// @dev Keyed by the Arkiv listing id, so the onchain rule and the offchain index
    /// refer to the same thing by the same name.
    mapping(string => Terms) private _terms;

    // ---------------------------------------------------------------------
    // The eligibility and transfer policy
    // ---------------------------------------------------------------------

    /// @notice Per-dataset denylist. The data owner decides who may not licence it.
    mapping(string => mapping(address => bool)) public denied;

    /// @notice Licences are non-transferable, and that is the transfer policy rather
    /// than an omission. A licence authorises training against one buyer's identity;
    /// making it tradeable would let access outlive the party that was vetted for it.
    /// There is intentionally no `transferFrom`.
    bool public constant TRANSFERABLE = false;

    // ---------------------------------------------------------------------
    // Settlement
    // ---------------------------------------------------------------------

    struct Licence {
        string listingId;
        address buyer;
        address dataOwner;
        uint64 startedAt;
        uint64 termSeconds;
        uint256 paid;
    }

    uint256 public nextLicenceId = 1;
    mapping(uint256 => Licence) public licences;

    /// @notice Proceeds are credited, not pushed. A push would hand control to the
    /// recipient mid-purchase and would fail outright for an owner that cannot receive
    /// a plain transfer; crediting keeps `purchase` free of both problems.
    mapping(address => uint256) public owed;

    event TermsRegistered(
        string indexed listingId,
        address indexed dataOwner,
        uint256 pricePerDayWei,
        uint64 minSeconds,
        uint64 maxSeconds
    );
    event TermsDeactivated(string indexed listingId);
    event EligibilityChanged(string indexed listingId, address indexed account, bool denied);
    event LicencePurchased(
        uint256 indexed licenceId,
        string indexed listingId,
        address indexed buyer,
        address dataOwner,
        uint64 termSeconds,
        uint256 paid
    );
    event Withdrawn(address indexed account, uint256 amount);

    error NotDataOwner();
    error NoSuchListing();
    error ListingInactive();
    error TermOutOfRange(uint64 requested, uint64 min, uint64 max);
    error NotEligible(address account);
    error WrongPayment(uint256 sent, uint256 required);
    error NothingOwed();
    error TransferFailed();
    error InvalidTerms();

    // ---------------------------------------------------------------------
    // Asset rule
    // ---------------------------------------------------------------------

    /// @notice Declares what a licence to `listingId` is. Re-registering updates the
    /// rule for future purchases; licences already sold keep the terms they were sold
    /// under, because they are recorded on the licence itself.
    function registerTerms(
        string calldata listingId,
        uint256 pricePerDayWei,
        uint64 minSeconds,
        uint64 maxSeconds,
        bytes32 schemaCommitment
    ) external {
        if (minSeconds == 0 || maxSeconds < minSeconds) revert InvalidTerms();

        Terms storage existing = _terms[listingId];
        // First registration claims the listing; later ones must come from its owner.
        if (existing.dataOwner != address(0) && existing.dataOwner != msg.sender) {
            revert NotDataOwner();
        }

        _terms[listingId] = Terms({
            dataOwner: msg.sender,
            pricePerDayWei: pricePerDayWei,
            minSeconds: minSeconds,
            maxSeconds: maxSeconds,
            schemaCommitment: schemaCommitment,
            active: true
        });

        emit TermsRegistered(listingId, msg.sender, pricePerDayWei, minSeconds, maxSeconds);
    }

    function deactivate(string calldata listingId) external {
        Terms storage terms = _terms[listingId];
        if (terms.dataOwner == address(0)) revert NoSuchListing();
        if (terms.dataOwner != msg.sender) revert NotDataOwner();
        terms.active = false;
        emit TermsDeactivated(listingId);
    }

    function termsFor(string calldata listingId) external view returns (Terms memory) {
        Terms memory terms = _terms[listingId];
        if (terms.dataOwner == address(0)) revert NoSuchListing();
        return terms;
    }

    // ---------------------------------------------------------------------
    // Eligibility policy
    // ---------------------------------------------------------------------

    function setEligibility(string calldata listingId, address account, bool deny) external {
        Terms storage terms = _terms[listingId];
        if (terms.dataOwner == address(0)) revert NoSuchListing();
        if (terms.dataOwner != msg.sender) revert NotDataOwner();
        denied[listingId][account] = deny;
        emit EligibilityChanged(listingId, account, deny);
    }

    // ---------------------------------------------------------------------
    // Settlement
    // ---------------------------------------------------------------------

    /// @notice Pro-rated from the daily price. Exposed so a client never has to
    /// reimplement the rounding and then disagree with the contract about the price.
    function quote(string calldata listingId, uint64 termSeconds)
        public
        view
        returns (uint256)
    {
        Terms memory terms = _terms[listingId];
        if (terms.dataOwner == address(0)) revert NoSuchListing();
        return (terms.pricePerDayWei * termSeconds) / 86_400;
    }

    /// @notice Buys a licence. Checks the rule, applies the policy, then settles.
    /// @dev Payment must be exact. Accepting more and refunding the difference means a
    /// transfer back to the buyer inside the purchase, which is the thing this contract
    /// avoids everywhere else.
    function purchase(string calldata listingId, uint64 termSeconds)
        external
        payable
        returns (uint256 licenceId)
    {
        Terms memory terms = _terms[listingId];

        if (terms.dataOwner == address(0)) revert NoSuchListing();
        if (!terms.active) revert ListingInactive();
        if (termSeconds < terms.minSeconds || termSeconds > terms.maxSeconds) {
            revert TermOutOfRange(termSeconds, terms.minSeconds, terms.maxSeconds);
        }
        if (denied[listingId][msg.sender]) revert NotEligible(msg.sender);

        uint256 required = (terms.pricePerDayWei * termSeconds) / 86_400;
        if (msg.value != required) revert WrongPayment(msg.value, required);

        licenceId = nextLicenceId++;
        licences[licenceId] = Licence({
            listingId: listingId,
            buyer: msg.sender,
            dataOwner: terms.dataOwner,
            startedAt: uint64(block.timestamp),
            termSeconds: termSeconds,
            paid: msg.value
        });

        owed[terms.dataOwner] += msg.value;

        emit LicencePurchased(
            licenceId, listingId, msg.sender, terms.dataOwner, termSeconds, msg.value
        );
    }

    function withdraw() external {
        uint256 amount = owed[msg.sender];
        if (amount == 0) revert NothingOwed();

        // Zeroed before the call: the balance is already gone as far as this contract
        // is concerned, so a reentrant call finds nothing left to claim.
        owed[msg.sender] = 0;

        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit Withdrawn(msg.sender, amount);
    }

    /// @notice Whether a licence's paid term has elapsed, by block timestamp.
    /// @dev Informational. Arkiv is authoritative for access — see the contract notice.
    function withinTerm(uint256 licenceId) external view returns (bool) {
        Licence memory licence = licences[licenceId];
        if (licence.buyer == address(0)) return false;
        return block.timestamp < licence.startedAt + licence.termSeconds;
    }
}
