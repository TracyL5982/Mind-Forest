// A small JSON value: enough to read the bundled files (ocean.json,
// clips.json, works.json) and to keep the shelf of saved trees. It stands in
// for a serializer: each type reads and writes itself by hand.
//
//   Json j = Json::parse(text); std::optional<T> v = T::from(j);
//   j["title"].string()   j["year"].integer(1900)   j["aspect"].number()   j["tags"].array()
//   j.has("why")          j["missing"].isNull()
#pragma once
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <vector>

class Json {
public:
    enum class Type { null, boolean, number, string, array, object };

    Json() = default;
    Json(std::nullptr_t) {}
    Json(bool b) : type_(Type::boolean), bool_(b) {}
    Json(double n) : type_(Type::number), number_(n) {}
    Json(float n) : type_(Type::number), number_(n) {}
    Json(int n) : type_(Type::number), number_(n) {}
    Json(long long n) : type_(Type::number), number_(double(n)) {}
    Json(const char* s) : type_(Type::string), string_(s) {}
    Json(std::string s) : type_(Type::string), string_(std::move(s)) {}
    Json(std::vector<Json> a) : type_(Type::array), array_(std::move(a)) {}

    static Json object() {
        Json j;
        j.type_ = Type::object;
        return j;
    }
    /// An array to push onto: `Json::list()`.
    static Json list(std::vector<Json> items = {}) { return Json(std::move(items)); }

    /// Parses text; nullopt if it is not JSON.
    static std::optional<Json> parse(const std::string& text);
    /// Writes it out, with keys in a fixed order. `pretty` indents.
    std::string dump(bool pretty = false) const;

    Type type() const { return type_; }
    bool isNull() const { return type_ == Type::null; }
    bool isString() const { return type_ == Type::string; }
    bool isNumber() const { return type_ == Type::number; }
    bool isBool() const { return type_ == Type::boolean; }
    bool isArray() const { return type_ == Type::array; }
    bool isObject() const { return type_ == Type::object; }

    /// Values, with what to give when the kind is wrong or it is missing.
    bool boolean(bool otherwise = false) const { return type_ == Type::boolean ? bool_ : otherwise; }
    double number(double otherwise = 0) const { return type_ == Type::number ? number_ : otherwise; }
    float real(float otherwise = 0) const { return type_ == Type::number ? float(number_) : otherwise; }
    int integer(int otherwise = 0) const { return type_ == Type::number ? int(number_) : otherwise; }
    const std::string& string() const { return string_; }
    std::string string(const std::string& otherwise) const { return type_ == Type::string ? string_ : otherwise; }
    /// A string or nullopt: for `let why: String?`.
    std::optional<std::string> optionalString() const { return type_ == Type::string ? std::optional(string_) : std::nullopt; }
    std::optional<double> optionalNumber() const { return type_ == Type::number ? std::optional(number_) : std::nullopt; }

    /// An array's items (empty when it is not an array).
    const std::vector<Json>& array() const { return array_; }
    /// An object's members, in key order (empty when it is not an object).
    const std::map<std::string, Json>& members() const { return object_; }

    bool has(const std::string& key) const { return type_ == Type::object && object_.count(key) && !object_.at(key).isNull(); }
    /// A member, or null when it isn't there.
    const Json& operator[](const std::string& key) const {
        static const Json none;
        if (type_ != Type::object) return none;
        auto it = object_.find(key);
        return it == object_.end() ? none : it->second;
    }
    const Json& operator[](const char* key) const { return (*this)[std::string(key)]; }
    /// An item, or null past the end.
    const Json& operator[](size_t i) const {
        static const Json none;
        return type_ == Type::array && i < array_.size() ? array_[i] : none;
    }
    const Json& operator[](int i) const { return (*this)[size_t(i)]; }
    size_t size() const { return type_ == Type::array ? array_.size() : type_ == Type::object ? object_.size() : 0; }

    /// Building: `j.set("title", title)`, `list.push(item)`.
    Json& set(const std::string& key, Json value) {
        if (type_ != Type::object) *this = object();
        object_[key] = std::move(value);
        return *this;
    }
    Json& push(Json value) {
        if (type_ != Type::array) *this = list();
        array_.push_back(std::move(value));
        return *this;
    }

private:
    Type type_ = Type::null;
    bool bool_ = false;
    double number_ = 0;
    std::string string_;
    std::vector<Json> array_;
    std::map<std::string, Json> object_;
    void write(std::string& out, bool pretty, int depth) const;
};
