from pydantic import BaseModel, ConfigDict, Field


class StrictContentModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, str_strip_whitespace=True)


class ProductDescription(StrictContentModel):
    title: str = Field(min_length=1, max_length=100)
    description: str = Field(min_length=1, max_length=2000)
    key_features: list[str] = Field(max_length=5)
    meta_description: str = Field(min_length=1, max_length=160)


class AdCopy(StrictContentModel):
    headline: str = Field(min_length=1, max_length=80)
    primary_text: str = Field(min_length=1, max_length=500)
    call_to_action: str = Field(min_length=1, max_length=40)


class EmailCampaign(StrictContentModel):
    subject_line: str = Field(min_length=1, max_length=120)
    preview_text: str = Field(min_length=1, max_length=180)
    body: str = Field(min_length=1, max_length=3000)
    call_to_action: str = Field(min_length=1, max_length=80)


class AltText(StrictContentModel):
    alt_text: str = Field(min_length=1, max_length=500)