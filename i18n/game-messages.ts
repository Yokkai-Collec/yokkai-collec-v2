// Stable data-error codes and canonical English compatibility DTOs only.
// Each compatibility message is registered once; unknown provider errors keep a safe fallback.
const codes = new Map<string, string>(
  Object.entries({
    ECONOMIC_MAINTENANCE: "cardErrors.economicMaintenance",
    "42501": "cardErrors.yourDataIsTemporarilyUnavailableRefreshThePage",
    AUTH_REQUIRED: "cardErrors.authRequired",
    PROFILE_MISSING: "cardErrors.profileMissing",
    PACK_NOT_READY: "cardErrors.packNotReady",
    INVALID_PACK_COUNT: "cardErrors.invalidPackCount",
    INSUFFICIENT_PACKS: "cardErrors.insufficientPacks",
    CATALOGUE_INCOMPLETE: "cardErrors.catalogueIncomplete",
    THREE_DISTINCT_LR_COPIES_REQUIRED:
      "cardErrors.threeDistinctLrCopiesRequired",
    FIVE_DISTINCT_LR_COPIES_REQUIRED:
      "cardErrors.threeDistinctLrCopiesRequired",
    INVALID_LR_COPIES: "cardErrors.invalidLrCopies",
    FIVE_DISTINCT_SSR_COPIES_REQUIRED:
      "cardErrors.fiveDistinctSsrCopiesRequired",
    INVALID_SSR_COPIES: "cardErrors.invalidSsrCopies",
    SSR_CARD_NOT_OWNED: "cardErrors.ssrCardNotOwned",
    NOT_ENOUGH_SSR_COPIES: "cardErrors.notEnoughSsrCopies",
    DECISION_PACK_NOT_READY: "cardErrors.decisionPackNotReady",
    DECISION_PACK_NOT_PENDING: "cardErrors.decisionPackNotPending",
    DECISION_CHOICE_UNAVAILABLE: "cardErrors.decisionChoiceUnavailable",
    DECISION_LAST_CHOICE: "cardErrors.decisionLastChoice",
    CARD_NOT_OWNED: "cardErrors.cardNotOwned",
    CARD_FROZEN: "cardErrors.cardFrozen",
    CARD_LOCKED: "cardErrors.cardLocked",
    INVALID_CARD_SELECTION: "cardErrors.invalidCardSelection",
    LICENSE_FOLDER_NAME_TAKEN: "licenseFolders.nameTaken",
    LICENSE_FOLDER_NAME_INVALID: "licenseFolders.invalidName",
    LICENSE_FOLDER_LIMIT: "licenseFolders.folderLimit",
    LICENSE_FOLDER_NOT_FOUND: "licenseFolders.notFound",
    FOLDER_NAME_TAKEN: "cardErrors.folderNameTaken",
    FOLDER_NOT_FOUND: "cardErrors.folderNotFound",
    PGRST301: "cardErrors.authRequired",
    PRO_REQUIRED: "cardErrors.thisFeatureIsAvailableToProMembersOnly",
    INVALID_IMGUR_URL: "cardErrors.enterAValidImgurLinkStartingWithHttps",
    PROFILE_NOT_FOUND: "profileUi.thisProfileCouldntBeFound",
    BIO_TOO_LONG: "profileUi.bioLengthLimit",
    AVATAR_URL_INVALID: "profileUi.avatarUrlInvalid",
    FEATURED_CARDS_INVALID: "profileUi.showcaseLimitExceeded",
    FRIENDS_ONLY: "profileUi.collectionFriendsOnly",
    PROFILE_PRIVATE: "profileUi.privateProfileCollection"
  })
);
// Tab-separated canonical message/key pairs, registered once.
const englishMessages = new Map<string, string>(
  `A folder with this name already exists.	cardErrors.folderNameTaken
A subscription already exists. Your status will update automatically. You can manage your subscription below.	settingsUi.subscriptionExists
Action saved. Refresh the auction to see its latest status.	profileUi.auctionActionSaved
Action unavailable.	shareUi.actionUnavailable
Active listings are temporarily unavailable.	profileUi.activeListingsUnavailable
Auction unavailable.	profileUi.auctionUnavailable
Banner framing is not available yet. Please try again after the update.	profileUi.bannerCropUnavailable
Banner framing is unavailable. Please try again after the update.	profileUi.bannerFramingUnavailable
Billing is temporarily unavailable. Please try again.	settingsUi.billingUnavailable
Board updated	profileUi.boardUpdated
Chat unavailable.	profileUi.chatUnavailable
Check your selection and try again.	profileUi.selectionInvalid
Choose 1, 5, or 10 Regular Packs.	cardErrors.invalidPackCount
Choose a card you own for your banner.	profileUi.ownedBannerRequired
Choose a card you own from your collection for your banner.	profileUi.bannerOwnershipRequired
Choose a GIF from the GIPHY picker.	privateMessages.errors.gif
Choose a GIF from the picker.	profileUi.chooseAGIFFromThePicker
Choose exactly five different copies of the same standard SSR card.	cardErrors.fiveDistinctSsrCopiesRequired
Choose exactly three different copies of the same normal LR card.	cardErrors.threeDistinctLrCopiesRequired
Choose five identical standard SSR copies.	cardErrors.invalidSsrCopies
Choose up to 12 licenses per category.	profileUi.licenseLimitHint
Collection unavailable.	profileUi.collectionUnavailable
Couldn't cancel this listing.	profileUi.couldntCancelThisListing
Couldn't change this card's lock.	collectionUi.couldntChangeThisCardsLock
Couldn't complete this action.	catalogueUi.couldntCompleteThisAction
Couldn't confirm this choice.	packs.couldntConfirmThisChoice
Couldn't create this auction.	collectionUi.couldntCreateThisAuction
Couldn't create this folder.	collectionUi.couldntCreateThisFolder
Couldn't create your referral link. Please try again.	settingsUi.referralLinkFailed
Couldn't customize this image.	collectionUi.couldntCustomizeThisImage
Couldn't delete this post.	profileUi.couldntDeleteThisPost
Couldn't destroy the selected cards.	collectionUi.couldntDestroyTheSelectedCards
Couldn't destroy this card.	collectionUi.couldntDestroyThisCard
Couldn't evolve this card.	collectionUi.couldntEvolveThisCard
Couldn't finish deleting this post and its files. Please try again.	profileUi.postCleanupFailed
Couldn't finish file cleanup. Please try again.	profileUi.fileCleanupFailed
Couldn't load	collectionUi.couldntLoad
Couldn't load achievements. Please try again in a moment.	achievementUi.unavailable
Couldn't load binders.	collectionUi.couldntLoadBinders
Couldn't load franchises. Please try again in a moment.	profileUi.franchisesLoadFailed
Couldn't load GIFs.	profileUi.couldntLoadGIFs
Couldn't load messages. Please try again.	privateMessages.errors.load
Couldn't load older messages.	privateMessages.errors.older
Couldn't load or update this post. Access may have changed. Please try again.	profileUi.postAccessChanged
Couldn't load profile data.	settingsUi.couldntLoadProfileData
Couldn't load settings.	settingsUi.couldntLoadSettings
Couldn't load the wall. Please try again in a moment.	profileUi.wallLoadFailed
Couldn't load this binder's cards.	collectionUi.couldntLoadThisBindersCards
Couldn't load this data.	gameUi.couldntLoadThisData
Couldn't load this page's activity. Please try again.	profileUi.pageActivityLoadFailed
Couldn't load this post's activity. Access may have changed.	profileUi.postActivityAccessChanged
Couldn't load this post's activity. Please try again.	profileUi.postActivityLoadFailed
Couldn't load your cards.	gameUi.couldntLoadYourCards
Couldn't load your profile privacy settings.	profileUi.privacyLoadFailed
Couldn't move the selected cards.	collectionUi.couldntMoveTheSelectedCards
Couldn't open this pack.	gameUi.couldntOpenThisPack
Couldn't place this bid.	profileUi.couldntPlaceThisBid
Couldn't publish your post. Your draft has been kept.	profileUi.publishFailedDraftKept
Couldn't reach game data. Please try again in a moment.	cardErrors.couldntReachGameDataPleaseTryAgainIn
Couldn't reach the market. Please try again.	profileUi.marketUnreachable
Couldn't reach the server. Check your connection and try again.	profileUi.serverUnreachable
Couldn't refresh this auction.	profileUi.couldntRefreshThisAuction
Couldn’t refresh your cards. Your last loaded collection is still shown.	collectionUi.couldntRefreshYourCardsYourLastLoadedCollection
Couldn't remove the file. Please try again.	profileUi.fileRemoveFailed
Couldn't remove this card from your wishlist.	catalogueUi.couldntRemoveThisCardFromYourWishlist
Couldn't resolve this favorite. Please try again.	cardErrors.couldntResolveThisFavoritePleaseTryAgain
Couldn't save changes.	profileUi.couldntSaveChanges
Couldn't save settings.	settingsUi.couldntSaveSettings
Couldn't save these favorites.	catalogueUi.couldntSaveTheseFavorites
Couldn't save your dashboard. Each section can contain up to 12 titles of 100 characters.	profileUi.dashboardSaveFailed
Couldn't save your widgets. Choose up to 12 catalog franchises per category; a franchise may have been renamed or removed.	profileUi.widgetSaveFailed
Couldn't sell these cards.	packs.couldntSellTheseCards
Couldn't send the message. Your draft has been kept.	privateMessages.errors.send
Couldn't send this message.	profileUi.couldntSendThisMessage
Couldn't send this report.	collectionShared.couldntSendThisReport
Couldn't sign out. Please try again.	settingsUi.signOutFailed
Couldn't submit this report.	profileUi.couldntSubmitThisReport
Couldn't update this favorite.	collectionUi.couldntUpdateThisFavorite
Couldn't update this post. Your draft has been kept.	profileUi.postUpdateDraftKept
Couldn't update this profile like. Please try again in a moment.	profileUi.profileLikeFailed
Couldn't update your profile privacy settings.	profileUi.privacySaveFailed
Couldn't update your watchlist.	profileUi.watchUpdateFailed
Couldn't update your wishlist.	collectionUi.couldntUpdateYourWishlist
Couldn't upload the image. Your text has been kept.	profileUi.imageUploadDraftKept
Couldn't upload this image.	profileUi.couldntUploadThisImage
Couldn't upload your banner. Please try again.	profileUi.bannerUploadFailed
Couldn't upload your profile photo. Please try again.	profileUi.avatarUploadFailed
Couldn't verify your username. Please try again later.	settingsUi.usernameCheckFailed
Details unavailable.	catalogueUi.detailsUnavailable
Download failed.	settingsUi.downloadFailed
Download failed. Please try again later.	settingsUi.downloadRetryLater
Download started. You can download your data again in 24 hours.	settingsUi.downloadStartedNotice
Download unavailable.	settingsUi.downloadUnavailable
Enter a valid Imgur link starting with https://i.imgur.com/ or https://imgur.com/.	cardErrors.enterAValidImgurLinkStartingWithHttps
Enter your username exactly to confirm.	settingsUi.usernameConfirmationHint
File cleanup is unavailable.	profileUi.fileCleanupIsUnavailable
Friends are temporarily unavailable. Please try again in a moment.	profileUi.friendsUnavailable
GIF search isn't configured.	profileUi.gifsearchIsnTConfigured
Image uploads are unavailable. Please try again.	profileUi.imageUploadUnavailable
Invalid card selection. Select between 1 and 500 copies.	cardErrors.invalidCardSelection
Invalid request.	settingsUi.invalidRequest
Invalid share link.	shareUi.invalidLink
JPG, PNG, WebP, or GIF, up to 6 MB.	profileUi.jpgpngwebPOrGIFUpTo6
Licenses unavailable.	profileUi.licensesUnavailable
Like unavailable.	profileUi.likeUnavailable
Likes are temporarily unavailable.	profileUi.likesUnavailable
Listings unavailable.	profileUi.listingsUnavailable
Messages are temporarily unavailable. Please try again.	privateMessages.errors.unavailable
Messages must contain 1–500 characters.	profileUi.chatContentLimit
No packs available right now.	cardErrors.packNotReady
Only friends can view the full collection.	profileUi.collectionFriendsOnly
Only the seller and bidders can join the chat.	profileUi.chatParticipantsOnly
Only the seller can cancel this listing.	profileUi.sellerCancellationOnly
Only three identical normal LR copies can evolve. Shiny and evolved cards are excluded.	cardErrors.invalidLrCopies
Owners unavailable.	catalogueUi.ownersUnavailable
Please wait a few seconds between replies (up to 30 per hour).	profileUi.replyRateLimit
Please wait a moment before sending another message.	privateMessages.errors.rate
Please wait a moment before trying again.	profileUi.actionCooldown
Post added to your wall	profileUi.postAddedToYourWall
Post deleted	profileUi.postDeleted
Preparing your data…	settingsUi.preparingYourData
Privacy settings updated	settingsUi.privacySettingsUpdated
Profile style updated	profileUi.profileStyleUpdated
Profile unavailable.	profileUi.profileUnavailable
Profile updated	profileUi.profileUpdated
Reply deleted	profileUi.replyDeleted
WALL_REPLY_UNAVAILABLE	profileUi.replyTargetUnavailable
Reply published	profileUi.replyPublished
Reporting this content isn't available yet.	profileUi.reportUnavailable
Request denied.	settingsUi.requestDenied
Shared links are temporarily unavailable.	shareUi.unavailable
Showcase updated	profileUi.showcaseUpdated
Sign in again to create your referral link.	settingsUi.referralReauthRequired
Sign in again to view this auction.	profileUi.auctionReauthRequired
Sign in again to view your messages.	privateMessages.errors.auth
Sign in again, then return to settings. You must have signed in within the last five minutes.	profileUi.settingsReauthRequired
Sign in to add an image.	profileUi.signInToAddAnImage
Sign in to continue.	profileUi.signInToContinue
Sign in to download your data.	settingsUi.signInToDownloadYourData
Sign in to finish file cleanup.	profileUi.signInToFinishFileCleanup
Sign in to manage your links.	shareUi.authRequired
Sign in to report this card.	cardErrors.cardReportsAuthRequired
Sign in to view your achievements.	achievementUi.authRequired
Sign in to view your collection and packs.	cardErrors.authRequired
Slow down. Please try again in a few seconds.	profileUi.chatRateLimit
Stats and board are temporarily unavailable.	profileUi.boardUnavailable
Suppression indisponible.	shareUi.deleteUnavailable
Thanks, your report has been submitted.	profileUi.reportSubmitted
The catalog is temporarily unavailable.	catalogueUi.theCatalogIsTemporarilyUnavailable
The catalog isn't ready yet. Please try again later.	cardErrors.catalogueIncomplete
The image is no longer available. Choose it again.	profileUi.postImageUnavailable
The image is unavailable. Please try again in a moment.	shareUi.imageUnavailable
The site's public address is unavailable.	shareUi.addressUnavailable
The username doesn't match. Enter your username exactly.	settingsUi.usernameMismatch
The wall is temporarily unavailable. Please try again in a moment.	profileUi.wallUnavailable
The wall is unavailable or its access has changed. Please try again.	profileUi.wallAccessChanged
The wishlist is temporarily unavailable.	cardErrors.wishlistUnavailable
This achievement isn't complete yet.	achievementUi.locked
This action is unavailable in the simulation.	gameUi.thisActionIsUnavailableInTheSimulation
This auction couldn't be found.	profileUi.thisAuctionCouldntBeFound
This auction has ended.	profileUi.thisAuctionHasEnded
This auction is currently unavailable.	profileUi.auctionCurrentlyUnavailable
This banner crop is invalid. Adjust the image and try again.	profileUi.bannerCropInvalid
This banner is not allowed. Upload a JPG, PNG, WebP or GIF image using the banner button.	profileUi.bannerSourceInvalid
This binder can't be added to favorites.	cardErrors.thisBinderCantBeAddedToFavorites
This binder couldn't be found.	cardErrors.wishlistBinderKeyRequired
This card couldn't be found.	cardErrors.wishlistCardNotFound
This card is already in your collection.	cardErrors.wishlistCardAlreadyOwned
This card is listed in an auction and can't be destroyed.	cardErrors.cardFrozen
This card is locked. Unlock it before doing this.	cardErrors.cardLocked
This card is no longer in your collection.	cardErrors.cardNotOwned
This conversation is no longer available.	privateMessages.errors.closed
This Decision Pack card is no longer available.	cardErrors.decisionChoiceUnavailable
This Decision Pack is no longer available.	cardErrors.decisionPackNotPending
This feature is available to Pro members only.	collectionUi.thisFeatureIsAvailableToProMembersOnly
This feature is temporarily unavailable. Please try again.	profileUi.featureUnavailable
This folder no longer exists.	cardErrors.folderNotFound
This friendship is no longer available.	profileUi.friendshipUnavailable
This GIF is invalid.	profileUi.thisGIFIsInvalid
This listing no longer belongs to this profile.	profileUi.listingOwnerChanged
This message couldn't be sent. Close the conversation and try again.	privateMessages.errors.conflict
This player has already sent you a friend request.	profileUi.incomingRequestExists
This post has reached its reply limit.	profileUi.postReplyLimit
This profile couldn't be found.	profileUi.thisProfileCouldntBeFound
This profile is private. Only friends can view its collection.	profileUi.privateProfileCollection
This report is invalid.	cardErrors.cardReportsReportInvalid
This request is no longer available.	profileUi.requestUnavailable
This reward has already been claimed.	achievementUi.alreadyClaimed
This SSR copy is no longer in your collection.	cardErrors.ssrCardNotOwned
This URL is not allowed. Use the button to upload your avatar (up to 2,048 characters).	profileUi.avatarUrlInvalid
This wall is private. Only their friends can view it.	profileUi.privateWallNotice
Unable to verify your subscription. Retrying automatically.	settingsUi.subscriptionVerificationRetry
Use a JPG, PNG, WebP or GIF image.	profileUi.useAJPGPNGWebPOrGIFImage
Wait a few seconds between posts (up to 30 per hour).	profileUi.postRateLimit
We couldn't finish deleting your account. Don't submit another request. Contact the team to check its status.	settingsUi.deletionStatusUnknown
We couldn't prepare your data. Try again; this attempt won't count toward your download limit.	settingsUi.exportPreparationFailed
Wishlist indisponible.	catalogueUi.wishlistIndisponible
Write a message between 1 and 2,000 characters.	privateMessages.errors.invalid
Write up to 1,000 characters, or add an image or GIF.	profileUi.replyContentLimit
Write up to 3,000 characters, or add an image or GIF.	profileUi.postContentLimit
You can add up to 8 different reactions to a post. Remove one to add another.	profileUi.reactionLimit
You can download your data once every 24 hours.	settingsUi.exportCooldownNotice
You can mention up to 3 different people per message.	profileUi.chatMentionLimit
You can only mention the seller or a player who has already bid.	profileUi.chatMentionParticipantsOnly
You can send a new request to this player later.	profileUi.friendRequestCooldown
You can't add yourself as a friend.	profileUi.selfFriendshipDenied
You can't bid on your own listing.	profileUi.selfBidDenied
You don't have enough Karas.	profileUi.youDontHaveEnoughKaras
You don't have enough packs for this batch. Choose a smaller quantity.	cardErrors.insufficientPacks
You don't have permission to do this. Sign in again and retry.	profileUi.permissionDenied
You must keep the last card.	cardErrors.decisionLastChoice
You must place a bid to join the chat.	profileUi.youMustPlaceABidToJoinThe
You need five identical SSR copies for this evolution.	cardErrors.notEnoughSsrCopies
You no longer own this card copy.	shareUi.cardNotOwned
You're already friends with this player.	profileUi.alreadyFriendsError
You've already reported this issue for this card.	cardErrors.cardReportsReportDuplicate
You've already reported this player in this context.	profileUi.duplicatePlayerReport
You've already sent this player a friend request.	profileUi.friendRequestExists
You've reached the daily limit of 10 reports.	profileUi.dailyReportLimit
You've reached the limit of 10 new links per UTC day.	shareUi.dailyLimit
You've reached today's report limit.	cardErrors.cardReportsReportLimit
You've reached your profile image upload limit. Try again later.	profileUi.profileImageRateLimit
You've sent too many friend requests. Try again later.	profileUi.friendRequestRateLimit
Your account is banned.	profileUi.yourAccountIsBanned
Your banner framing is invalid.	profileUi.bannerFramingInvalid
Your banner must be 4 MB or smaller.	profileUi.bannerSizeLimit
Your bid must be at least 10 Karas above the current bid.	profileUi.minimumBidIncrement
Your bio can contain up to 300 characters.	profileUi.bioLengthLimit
Your cards couldn’t load.	collectionUi.yourCardsCouldntLoad
Your daily Decision Pack isn't available yet.	cardErrors.decisionPackNotReady
Your data download is already being prepared.	settingsUi.exportAlreadyPreparing
Your data exceeds the automatic download size limit. Email yokkaicollec@gmail.com with the subject Data export request from your account email address to request a complete export. Do not send your password or sign-in codes. This attempt does not count toward your download limit.	settingsUi.exportSizeLimit
Your data is temporarily unavailable. Refresh the page or sign in again.	cardErrors.yourDataIsTemporarilyUnavailableRefreshThePage
Your image must be 4 MB or smaller.	profileUi.profileImageSizeLimit
Your profile couldn't be found.	achievementUi.profileMissing
Your profile couldn't be found. The game couldn't be loaded.	cardErrors.profileMissing
Your profile photo must be 4 MB or smaller.	profileUi.avatarSizeLimit
Your profile style couldn't be saved. Try again.	profileUi.styleSaveFailed
Your showcase selection exceeds your membership limit.	profileUi.showcaseLimitExceeded
Your wall already has 500 posts. Delete one to continue.	profileUi.wallPostLimit
Your wall has reached its 100 MB image quota. Delete an older post with an image to continue.	profileUi.wallStorageLimit`
    .split("\n")
    .map(pair => pair.split("\t") as [string, string])
);
export function gameErrorKey(
  error: unknown,
  fallback = "cardErrors.couldntReachGameDataPleaseTryAgainIn"
) {
  if (typeof error === "string")
    return keys.has(error)
      ? error
      : (englishMessages.get(error) ?? codes.get(error) ?? fallback);
  if (error && typeof error === "object") {
    const value = error as {
      message?: unknown;
      code?: unknown;
      cause?: { i18nKey?: unknown };
    };
    const key = value.cause?.i18nKey;
    if (keys.has(key as string)) return key as string;
    if (typeof value.message === "string")
      return (
        codes.get(value.message) ??
        englishMessages.get(value.message) ??
        (typeof value.code === "string" ? codes.get(value.code) : undefined) ??
        fallback
      );
  }
  return fallback;
}
const keys = new Set([...codes.values(), ...englishMessages.values()]);
