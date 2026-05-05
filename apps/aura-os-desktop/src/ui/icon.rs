//! Compile-time RGBA decode of the desktop window icon, kept in a small
//! struct so we can clone it cheaply for IDE child windows.

use tao::window::Icon;

pub(crate) struct IconData {
    pub(crate) rgba: Vec<u8>,
    pub(crate) width: u32,
    pub(crate) height: u32,
}

impl IconData {
    pub(crate) fn to_icon(&self) -> Icon {
        Icon::from_rgba(self.rgba.clone(), self.width, self.height)
            .expect("failed to create icon from stored data")
    }
}

pub(crate) fn load_icon_data() -> IconData {
    let png_bytes = include_bytes!("../../assets/icons/icon-512.png");
    let img = image::load_from_memory(png_bytes).expect("failed to decode icon");
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    IconData {
        rgba: rgba.into_raw(),
        width: w,
        height: h,
    }
}
