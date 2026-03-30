from __future__ import annotations
from typing import Any
from pydantic import BaseModel, Field

class SignupIn(BaseModel):
    email: str
    recovery_email: str = ""
    password: str
    nickname: str
    phone: str
    phone_verification_token: str
    captcha_token: str = ""

class LoginIn(BaseModel):
    email: str
    password: str
    captcha_token: str = ""

class PhoneCodeRequestIn(BaseModel):
    phone: str
    captcha_token: str = ""

class PhoneCodeVerifyIn(BaseModel):
    phone: str
    code: str
    captcha_token: str = ""

class ProfileIn(BaseModel):
    title: str
    slug: str = ""
    display_name: str = ""
    gender: str = ""
    birth_year: str = ""
    feed_profile_public: bool = False
    profile_image_url: str = ""
    cover_image_url: str = ""
    headline: str = ""
    bio: str = ""
    location: str = ""
    current_work: str = ""
    industry_category: str = ""
    theme_color: str = "#3b82f6"
    visibility_mode: str = "link_only"
    question_permission: str = "any"

class CareerIn(BaseModel):
    title: str
    one_line: str = ""
    period: str = ""
    role_name: str = ""
    description: str = ""
    review_text: str = ""
    image_url: str = ""
    gallery_json: list[str] = Field(default_factory=list)
    media_items: list[dict[str, Any]] = Field(default_factory=list)
    is_public: bool = True
    sort_order: int = 0

class IntroductionIn(BaseModel):
    title: str
    category: str = "freeform"
    content: str = ""
    is_public: bool = False

class LinkIn(BaseModel):
    title: str
    original_url: str
    short_code: str = ""
    link_type: str = "external"
    is_public: bool = True

class QrIn(BaseModel):
    title: str
    target_url: str
    is_public: bool = True

class QuestionAskIn(BaseModel):
    question_text: str
    nickname: str = "익명"
    captcha_token: str = ""

class QuestionAnswerIn(BaseModel):
    answer_text: str
    status: str = "answered"

class QuestionCommentIn(BaseModel):
    comment_text: str
    nickname: str = "익명"
    captcha_token: str = ""

class MessageIn(BaseModel):
    message: str

class ReportIn(BaseModel):
    target_type: str
    target_id: int
    reason: str
    details: str = ""
    captcha_token: str = ""

class UploadReviewIn(BaseModel):
    moderation_status: str
    moderation_note: str = ""

class ResolveReportIn(BaseModel):
    status: str = "resolved"
    resolution_note: str = ""

class BulkReportResolveIn(BaseModel):
    report_ids: list[int] = Field(default_factory=list)
    status: str = "resolved"
    resolution_note: str = ""

class BulkUploadReviewIn(BaseModel):
    upload_ids: list[int] = Field(default_factory=list)
    moderation_status: str = "approved"
    moderation_note: str = ""

class AdminUserUpdateIn(BaseModel):
    extra_profile_slots: int = 0
    role: str | None = None
    grade: int | None = None
    account_status: str | None = None
    suspended_reason: str = ''
    chat_media_quota_mb: int | None = None

class IntegrationSmsTestIn(BaseModel):
    phone: str


class FeedPostCreateIn(BaseModel):
    title: str = ""
    content: str = ""
    image_url: str = ""

class FeedStoryCreateIn(BaseModel):
    title: str = ""
    content: str = ""
    image_url: str = ""

class FriendRequestActionIn(BaseModel):
    action: str = "accept"


class CommunityPostCreateIn(BaseModel):
    primary_category: str = "일반"
    secondary_category: str = "자유"
    title: str = ""
    content: str = ""
    attachment_url: str = ""


class CommunityCommentCreateIn(BaseModel):
    content: str = ""
